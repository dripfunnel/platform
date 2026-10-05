import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import { createInventoryService, defaultLowStock, inventoryAudit, type InventoryRefusal, type InventoryResult, type StockLevelRow, type StockMovementRow, type StockVersionRow, type WarehouseRow } from '#engine/modules/inventory/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Stock and stock locations (CATALOG-DESIGN G, SetOps; FIRST-RELEASE §11, §19). Every quantity is the
// caller's scope's, so a supplier never reads another owner's count (ACCESS §7.4).

const words: Record<InventoryRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That isn’t here any more.',
  STALE_REVISION: 'Someone else saved this. Reload to see their changes.',
  BELOW_ZERO: 'Stock can’t go below zero.',
  TOO_MANY_WAREHOUSES: 'You can have up to 20 locations. Remove one first.',
  DEFAULT_WAREHOUSE: 'Make another location the default first.',
  WAREHOUSE_HOLDS_STOCK: 'This location still holds stock. Set it to 0 or move it first.',
}

const answered = <T>(result: InventoryResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

export const registerInventory = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createInventoryService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  const Address = builder.objectRef<WarehouseRow['address']>('WarehouseAddress').implement({
    fields: (t) => ({
      line1: t.exposeString('line1', { nullable: true }),
      line2: t.exposeString('line2', { nullable: true }),
      city: t.exposeString('city', { nullable: true }),
      region: t.exposeString('region', { nullable: true }),
      postalCode: t.exposeString('postalCode', { nullable: true }),
      country: t.exposeString('country', { nullable: true }),
    }),
  })
  const Warehouse = builder.objectRef<WarehouseRow>('Warehouse').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      address: t.field({ type: Address, resolve: (w) => w.address }),
      // New products start at the owner's default (SetOps).
      isDefault: t.exposeBoolean('is_default'),
      // A supplier's location, which the merchant side reads but doesn't change; null is the merchant's.
      supplierId: t.exposeID('seller_id', { nullable: true }),
      units: t.exposeInt('units'),
      revision: t.exposeInt('revision'),
    }),
  })
  const WarehousePage = builder.objectRef<{ nodes: WarehouseRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('WarehousePage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Warehouse], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const StockLevel = builder.objectRef<StockLevelRow>('StockLevel').implement({
    fields: (t) => ({
      warehouseId: t.exposeID('warehouse_id'),
      warehouseName: t.exposeString('warehouse_name'),
      isDefault: t.exposeBoolean('is_default'),
      onHand: t.exposeInt('on_hand'),
      // Sold, not shipped yet (G3).
      reserved: t.exposeInt('reserved'),
      lowStockThreshold: t.int({ resolve: (l) => l.low_stock_threshold ?? defaultLowStock }),
    }),
  })
  const StockVersion = builder.objectRef<StockVersionRow>('StockVersion').implement({
    fields: (t) => ({ versionId: t.exposeID('version_id'), levels: t.field({ type: [StockLevel], resolve: (v) => v.levels }) }),
  })
  const StockVersionPage = builder.objectRef<{ nodes: StockVersionRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('StockVersionPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [StockVersion], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Movement = builder.objectRef<StockMovementRow>('StockMovement').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      versionId: t.exposeID('version_id'),
      warehouseId: t.exposeID('warehouse_id'),
      warehouseName: t.exposeString('warehouse_name'),
      delta: t.exposeInt('delta'),
      resultingQuantity: t.exposeInt('resulting_quantity'),
      // received, returned, damaged, counted, typed, starting, order, import (DATA-MODEL §7.4).
      reason: t.exposeString('reason'),
      actorKind: t.exposeString('actor_kind'),
      actorName: t.exposeString('actor_name', { nullable: true }),
      occurredAt: t.string({ resolve: (m) => m.occurred_at.toISOString() }),
    }),
  })
  const MovementPage = builder.objectRef<{ nodes: StockMovementRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('StockMovementPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Movement], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Quantity = builder.objectRef<{ versionId: string; warehouseId: string; quantity: number }>('StockQuantity').implement({
    fields: (t) => ({ versionId: t.exposeID('versionId'), warehouseId: t.exposeID('warehouseId'), quantity: t.exposeInt('quantity') }),
  })

  const AddressInput = builder.inputType('WarehouseAddressInput', {
    fields: (t) => ({ line1: t.string(), line2: t.string(), city: t.string(), region: t.string(), postalCode: t.string(), country: t.string() }),
  })
  const WarehouseInput = builder.inputType('WarehouseInput', {
    fields: (t) => ({ name: t.string({ required: true }), address: t.field({ type: AddressInput }) }),
  })
  const QuantityInput = builder.inputType('StockQuantityInput', {
    fields: (t) => ({ versionId: t.id({ required: true }), warehouseId: t.id({ required: true }), quantity: t.int({ required: true }) }),
  })

  const read = { api: 'store', scope: 'store-seller', permission: 'stock.read', target: 'none' } as const
  const write = { api: 'store', scope: 'store-seller', permission: 'stock.write', target: 'none' } as const
  const places = { api: 'store', scope: 'store-seller', permission: 'warehouses.write', target: 'none' } as const

  builder.queryFields((t) => ({
    warehouses: t.field({
      type: WarehousePage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).warehouses(window), window, (w) => ({ occurredAt: w.created_at, id: w.id }))
      },
    }),
    // A page of versions in the editor's order, each with its levels (G2).
    productStock: t.field({
      type: StockVersionPage,
      args: { productId: t.arg.id({ required: true }), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).productStock(String(args.productId), window), window, (v) => ({ occurredAt: new Date(-v.position), id: v.version_id }))
      },
    }),
    stockHistory: t.field({
      type: MovementPage,
      args: { productId: t.arg.id({ required: true }), versionId: t.arg.id(), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        const rows = await service(ctx).history(String(args.productId), args.versionId === null || args.versionId === undefined ? null : String(args.versionId), window)
        return pageOf(rows, window, (m) => ({ occurredAt: m.occurred_at, id: m.id }))
      },
    }),
  }))

  builder.mutationFields((t) => ({
    // Answers the quantity now there.
    adjustStock: t.int({
      args: { versionId: t.arg.id({ required: true }), warehouseId: t.arg.id({ required: true }), delta: t.arg.int({ required: true }), reason: t.arg.string({ required: true }) },
      extensions: { access: { ...write, audit: inventoryAudit.adjusted } },
      resolve: async (_, args, ctx) => answered(await service(ctx).adjust(String(args.versionId), String(args.warehouseId), args.delta, args.reason)),
    }),
    setStock: t.field({
      type: [Quantity],
      args: { entries: t.arg({ type: [QuantityInput], required: true }) },
      extensions: { access: { ...write, audit: inventoryAudit.adjusted } },
      resolve: async (_, args, ctx) => answered(await service(ctx).setQuantities(args.entries.map((e) => ({ versionId: String(e.versionId), warehouseId: String(e.warehouseId), quantity: e.quantity })))),
    }),
    // Null goes back to the store's default of 5 (CatList).
    setLowStockThreshold: t.int({
      nullable: true,
      args: { versionId: t.arg.id({ required: true }), warehouseId: t.arg.id({ required: true }), threshold: t.arg.int() },
      extensions: { access: { ...write, audit: inventoryAudit.thresholdSet } },
      resolve: async (_, args, ctx) => answered(await service(ctx).setThreshold(String(args.versionId), String(args.warehouseId), args.threshold ?? null)),
    }),
    saveWarehouse: t.id({
      args: { id: t.arg.id(), revision: t.arg.int(), input: t.arg({ type: WarehouseInput, required: true }) },
      extensions: { access: { ...places, audit: inventoryAudit.warehouseSaved } },
      resolve: async (_, args, ctx) => answered(await service(ctx).saveWarehouse(args.id === null || args.id === undefined ? null : String(args.id), args.revision ?? null, args.input)),
    }),
    setDefaultWarehouse: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...places, audit: inventoryAudit.warehouseSaved } },
      resolve: async (_, args, ctx) => answered(await service(ctx).setDefault(String(args.id))),
    }),
    deleteWarehouse: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...places, audit: inventoryAudit.warehouseDeleted } },
      resolve: async (_, args, ctx) => answered(await service(ctx).deleteWarehouse(String(args.id))),
    }),
  }))
}
