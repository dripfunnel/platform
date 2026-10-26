import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { PageWindow } from '#core/paging'
import { pinSchema } from '#core/pin'
import type { TenantContext } from '#core/tenancy'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import { queueStoreEvent, queueStoreEvents } from '#db/scoped/storeEvents'
import {
  changeStock,
  countWarehouses,
  insertWarehouse,
  makeDefaultWarehouse,
  maxWarehouses,
  selectPricingCurrency,
  selectProductStock,
  selectStockHistory,
  selectWarehouse,
  selectWarehouses,
  setLowStockThreshold,
  setStockTargets,
  softDeleteWarehouse,
  stockRefused,
  updateWarehouse,
  type ChangeReason,
  type WarehouseAddress,
  type WarehouseDelivery,
  type WarehouseRow,
} from '#db/scoped/inventory'
import { isUuid } from '#core/ids'
import { parseMinor } from '#core/money'

// Inventory (PLATFORM-PROMPT §5.4, CATALOG-DESIGN G, SetOps): each owner counts its own locations, and
// every change to a quantity is a movement with its reason, by the database (migration 0046).

export { defaultLowStock, type StockLevelRow, type StockMovementRow, type StockVersionRow, type WarehouseRow } from '#db/scoped/inventory'

export const inventoryAudit = {
  adjusted: 'stock.adjusted',
  thresholdSet: 'stock.threshold_set',
  warehouseSaved: 'warehouse.saved',
  warehouseDeleted: 'warehouse.deleted',
} as const

export type InventoryRefusal =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'STALE_REVISION'
  | 'BELOW_ZERO'
  | 'TOO_MANY_WAREHOUSES'
  | 'DEFAULT_WAREHOUSE'
  | 'WAREHOUSE_HOLDS_STOCK'
  | 'DELIVERY_AREA_REQUIRED'
export type InventoryResult<T> = { ok: true; value: T } | { ok: false; reason: InventoryRefusal }

/** The reasons a person gives (G4); a typed number is `typed`, and the first count of a location `starting`. */
export const adjustReasons = ['received', 'returned', 'damaged', 'counted'] as const
export type AdjustReason = (typeof adjustReasons)[number]

/** One save of the editor or the list's quick edit, in one transaction. */
export const maxStockEntries = 100
const maxQuantity = 1_000_000


class Refused extends Error {
  constructor(readonly reason: InventoryRefusal) {
    super(reason)
  }
}

export interface WarehouseInput {
  name: string
  address?: Partial<Record<keyof WarehouseAddress, string | null | undefined>> | null | undefined
  /** Both or neither (#815); left out, the saved pin stays. */
  latitude?: number | null | undefined
  longitude?: number | null | undefined
  /** Own delivery (DELIVERY §2), the merchant's locations only; each left out keeps what is saved. */
  ownDelivery?: boolean | null | undefined
  deliveryRadiusM?: number | null | undefined
  riderRadiusM?: number | null | undefined
  deliveryFeeAmount?: string | null | undefined
}

/** A delivery area and a rider distance: 1–50 km, in metres (DELIVERY §2). */
const radiusOk = (metres: number) => Number.isInteger(metres) && metres >= 1000 && metres <= 50_000

const deliveryAsked = (input: WarehouseInput) =>
  input.ownDelivery != null || input.deliveryRadiusM !== undefined || input.riderRadiusM != null || input.deliveryFeeAmount !== undefined

/** The location's own-delivery settings after this save; the fee in the pricing currency (DATA-MODEL §7.12). */
const cleanDelivery = (input: WarehouseInput, saved: WarehouseRow | null, currency: string): WarehouseDelivery => {
  const radius = input.deliveryRadiusM !== undefined ? input.deliveryRadiusM : (saved?.delivery_radius_m ?? null)
  const rider = input.riderRadiusM ?? saved?.rider_radius_m ?? 5000
  if ((radius !== null && !radiusOk(radius)) || !radiusOk(rider)) throw new Refused('INVALID_INPUT')
  let fee = saved?.delivery_fee_amount != null && saved.delivery_fee_currency ? { amount: BigInt(saved.delivery_fee_amount), currency: saved.delivery_fee_currency } : null
  if (input.deliveryFeeAmount !== undefined) {
    const typed = input.deliveryFeeAmount?.trim() ?? ''
    fee = typed === '' ? null : parseMinor(typed, currency)
    if (typed !== '' && !fee) throw new Refused('INVALID_INPUT')
  }
  const ownDelivery = input.ownDelivery ?? saved?.own_delivery ?? false
  if (ownDelivery && fee === null) throw new Refused('INVALID_INPUT')
  return { ownDelivery, deliveryRadiusM: radius, riderRadiusM: rider, feeAmount: fee?.amount ?? null, feeCurrency: fee?.currency ?? null }
}

const addressKeys = ['line1', 'line2', 'city', 'region', 'postalCode', 'country'] as const

const cleanWarehouse = (input: WarehouseInput) => {
  const name = input.name.trim()
  if (name === '' || name.length > 80) throw new Refused('INVALID_INPUT')
  const address = Object.fromEntries(
    addressKeys.map((key) => {
      const value = input.address?.[key]?.trim() ?? ''
      if (value.length > 120) throw new Refused('INVALID_INPUT')
      return [key, value === '' ? null : key === 'country' ? value.toUpperCase() : value]
    }),
  ) as unknown as WarehouseAddress
  if (address.country !== null && !/^[A-Z]{2}$/.test(address.country)) throw new Refused('INVALID_INPUT')
  if (input.latitude === undefined && input.longitude === undefined) return { name, address }
  const pin = pinSchema.safeParse({ latitude: input.latitude, longitude: input.longitude })
  if (!pin.success) throw new Refused('INVALID_INPUT')
  return { name, address, pin: pin.data.latitude === null ? null : { latitude: pin.data.latitude, longitude: pin.data.longitude } }
}

const whole = (value: number, min: number): number => {
  if (!Number.isInteger(value) || value < min || value > maxQuantity) throw new Refused('INVALID_INPUT')
  return value
}

export interface InventoryDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createInventoryService = ({ sql, context, actor, activity, facts, now }: InventoryDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const entry = (action: string, target: { type: string; id: string; label: string }, reason: string | null = null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId,
    target,
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<InventoryResult<T>> => {
    try {
      return { ok: true, value: await inScope(work) }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      const refused = stockRefused(error)
      if (refused) return { ok: false, reason: refused }
      throw error
    }
  }

  /** The caller's own location: the merchant side changes only the merchant's, a supplier only its own. */
  const ownWarehouse = async (tx: ScopedSql, id: string) => {
    const w = isUuid(id) ? await selectWarehouse(tx, storeId, id) : null
    if (!w || w.seller_id !== sellerId) throw new Refused('NOT_FOUND')
    return w
  }

  const warehouses = (window: PageWindow) => inScope((tx) => selectWarehouses(tx, storeId, window))

  const saveWarehouse = (id: string | null, revision: number | null, input: WarehouseInput) =>
    run(async (tx) => {
      const clean = cleanWarehouse(input)
      // A supplier's location never delivers with the store's riders (DELIVERY §2).
      if (sellerId !== null && (input.ownDelivery === true || input.deliveryRadiusM != null || input.riderRadiusM != null || input.deliveryFeeAmount != null)) throw new Refused('INVALID_INPUT')
      const saved = id === null ? null : await ownWarehouse(tx, id)
      const asked = sellerId === null && deliveryAsked(input)
      const currency = asked ? await selectPricingCurrency(tx, storeId) : null
      if (asked && !currency) throw new Refused('INVALID_INPUT')
      const delivery = currency ? cleanDelivery(input, saved, currency) : undefined
      const pinned = clean.pin === undefined ? saved?.latitude != null : clean.pin !== null
      const delivers = delivery?.ownDelivery ?? saved?.own_delivery ?? false
      const area = delivery ? delivery.deliveryRadiusM : (saved?.delivery_radius_m ?? null)
      if (delivers && (!pinned || area === null)) throw new Refused('DELIVERY_AREA_REQUIRED')
      const fields = delivery ? { ...clean, delivery } : clean
      let warehouseId: string
      if (id === null) {
        await serialise(tx, `warehouse:${storeId}:${sellerId ?? ''}`)
        if ((await countWarehouses(tx, storeId, sellerId)) >= maxWarehouses) throw new Refused('TOO_MANY_WAREHOUSES')
        warehouseId = crypto.randomUUID()
        await insertWarehouse(tx, storeId, sellerId, warehouseId, fields)
      } else {
        if (revision === null || !(await updateWarehouse(tx, storeId, id, revision, fields, now()))) throw new Refused('STALE_REVISION')
        warehouseId = id
      }
      const reason = delivery && delivery.ownDelivery !== (saved?.own_delivery ?? false) ? `own delivery ${delivery.ownDelivery ? 'on' : 'off'}` : null
      await activity.record(tx, entry(inventoryAudit.warehouseSaved, { type: 'warehouse', id: warehouseId, label: clean.name }, reason))
      return warehouseId
    })

  /** "Make default" (SetOps): new products start here; existing stock doesn't move. */
  const setDefault = (id: string) =>
    run(async (tx) => {
      const w = await ownWarehouse(tx, id)
      await serialise(tx, `warehouse:${storeId}:${sellerId ?? ''}`)
      if (!(await makeDefaultWarehouse(tx, storeId, id, now()))) throw new Refused('NOT_FOUND')
      await activity.record(tx, entry(inventoryAudit.warehouseSaved, { type: 'warehouse', id, label: `${w.name}: default` }))
      return true
    })

  const deleteWarehouse = (id: string) =>
    run(async (tx) => {
      await ownWarehouse(tx, id)
      const gone = await softDeleteWarehouse(tx, storeId, id, now())
      if (gone === null) throw new Refused('NOT_FOUND')
      if (gone === 'default') throw new Refused('DEFAULT_WAREHOUSE')
      if (gone === 'holds_stock') throw new Refused('WAREHOUSE_HOLDS_STOCK')
      await activity.record(tx, entry(inventoryAudit.warehouseDeleted, { type: 'warehouse', id, label: gone.name }))
      return true
    })

  const productStock = (productId: string, window: PageWindow) => inScope((tx) => (isUuid(productId) ? selectProductStock(tx, storeId, productId, window) : Promise.resolve([])))

  const moved = (versionId: string, warehouseId: string, reason: ChangeReason, delta: number, quantity: number) =>
    entry(inventoryAudit.adjusted, { type: 'product_version', id: versionId, label: `${reason} ${delta > 0 ? '+' : ''}${delta} → ${quantity} at ${warehouseId}` })

  /** "Change stock with a reason" (G4): the answer is the quantity now there. */
  const adjust = (versionId: string, warehouseId: string, delta: number, reason: string) =>
    run(async (tx) => {
      if (!(adjustReasons as readonly string[]).includes(reason) || delta === 0 || !Number.isInteger(delta) || Math.abs(delta) > maxQuantity) throw new Refused('INVALID_INPUT')
      if (!isUuid(versionId) || !isUuid(warehouseId)) throw new Refused('NOT_FOUND')
      const { quantity } = await changeStock(tx, versionId, warehouseId, { delta }, reason as AdjustReason)
      await activity.record(tx, moved(versionId, warehouseId, reason as AdjustReason, delta, quantity))
      await queueStoreEvent(tx, storeId, 'stock.changed', { object: 'product_version', id: versionId.toLowerCase() }, crypto.randomUUID(), now())
      return quantity
    })

  /** Typed numbers, from the editor's save or the list's quick edit; each one that changes is a movement. */
  const setQuantities = (entries: readonly { versionId: string; warehouseId: string; quantity: number }[]) =>
    run(async (tx) => {
      if (entries.length === 0 || entries.length > maxStockEntries) throw new Refused('INVALID_INPUT')
      const keys = new Set(entries.map((e) => `${e.versionId.toLowerCase()}:${e.warehouseId.toLowerCase()}`))
      if (keys.size !== entries.length) throw new Refused('INVALID_INPUT')
      if (!entries.every((e) => isUuid(e.versionId) && isUuid(e.warehouseId))) throw new Refused('NOT_FOUND')
      const wanted = entries.map((e) => ({ versionId: e.versionId.toLowerCase(), warehouseId: e.warehouseId.toLowerCase(), target: whole(e.quantity, 0) }))
      const done = await setStockTargets(tx, wanted)
      await activity.recordAll(tx, done.filter((d) => d.change !== 0).map((d) => moved(d.version_id, d.warehouse_id, 'typed', d.change, d.quantity)))
      await queueStoreEvents(tx, storeId, 'stock.changed', [...new Set(done.filter((d) => d.change !== 0).map((d) => d.version_id))].map((id) => ({ object: 'product_version' as const, id })), now())
      const byKey = new Map(done.map((d) => [`${d.version_id}:${d.warehouse_id}`, d.quantity]))
      // Answered in the order sent, whatever order the database applied them in.
      return wanted.map((e) => ({ versionId: e.versionId, warehouseId: e.warehouseId, quantity: byKey.get(`${e.versionId}:${e.warehouseId}`) ?? 0 }))
    })

  const setThreshold = (versionId: string, warehouseId: string, threshold: number | null) =>
    run(async (tx) => {
      if (!isUuid(versionId)) throw new Refused('NOT_FOUND')
      // The merchant side reads a supplier's thresholds but never sets them: they drive the supplier's chip.
      await ownWarehouse(tx, warehouseId)
      const clean = threshold === null ? null : whole(threshold, 0)
      if (!(await setLowStockThreshold(tx, storeId, sellerId, versionId, warehouseId, clean))) throw new Refused('NOT_FOUND')
      await activity.record(tx, entry(inventoryAudit.thresholdSet, { type: 'product_version', id: versionId, label: clean === null ? 'default' : String(clean) }))
      return clean
    })

  const history = (productId: string, versionId: string | null, window: PageWindow) =>
    inScope((tx) => (isUuid(productId) && (versionId === null || isUuid(versionId)) ? selectStockHistory(tx, storeId, productId, versionId, window) : Promise.resolve([])))

  return { warehouses, saveWarehouse, setDefault, deleteWarehouse, productStock, adjust, setQuantities, setThreshold, history }
}
