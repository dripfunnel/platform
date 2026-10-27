import { GraphQLError } from 'graphql'
import { z } from 'zod'
import { pageOf, pageWindow, type Page } from '#core/paging'
import { carryAudit, createCarry, deliveryStates, dispatchAudit, failReasons, type CarriedCustomer, type RiderDeliveryView } from '#engine/modules/ownDelivery/index'
import { carryPorts } from '../graphql/carryPorts'
import { withDispatchCode } from '../graphql/dispatchRefusals'
import { riderOf, type DeliveryContext } from './access'
import type { DeliveryBuilder } from './builder'

type Place = CarriedCustomer['address']
type Row = Omit<RiderDeliveryView, 'lines' | 'customer'> & Partial<Pick<RiderDeliveryView, 'lines' | 'customer'>>
type Listed = Page<Row> & { deliveredToday: number; deliveredThisWeek: number }

const placeSchema = z.object({ line1: z.string().nullish(), line2: z.string().nullish(), city: z.string().nullish(), region: z.string().nullish(), postalCode: z.string().nullish(), country: z.string().nullish() }).loose()
const placeOf = (raw: Record<string, unknown>): Place => {
  const p = placeSchema.safeParse(raw)
  const a = p.success ? p.data : {}
  return { line1: a.line1 ?? null, line2: a.line2 ?? null, city: a.city ?? null, region: a.region ?? null, postalCode: a.postalCode ?? null, country: a.country ?? null }
}
const iso = (at: Date | null) => at?.toISOString() ?? null

const service = (ctx: DeliveryContext) => {
  const { sql, rider } = riderOf(ctx)
  return createCarry({ sql, context: rider, activity: ctx.activity, facts: ctx.facts, now: ctx.now, secrets: ctx.secrets ?? null, ports: carryPorts })
}

export const registerCarry = (builder: DeliveryBuilder) => {
  const access = { api: 'delivery', scope: 'rider', permission: null } as const
  const State = builder.enumType('DeliveryState', { values: deliveryStates })
  const FailReason = builder.enumType('NotDeliveredReason', { values: failReasons })
  const Address = builder.objectRef<Place>('DeliveryAddress').implement({ fields: (t) => ({
    line1: t.exposeString('line1', { nullable: true }), line2: t.exposeString('line2', { nullable: true }), city: t.exposeString('city', { nullable: true }),
    region: t.exposeString('region', { nullable: true }), postalCode: t.exposeString('postalCode', { nullable: true }), country: t.exposeString('country', { nullable: true }),
  }) })
  const Warehouse = builder.objectRef<Row>('DeliveryWarehouse').implement({ fields: (t) => ({
    name: t.exposeString('warehouse_name'),
    address: t.field({ type: Address, resolve: (d) => placeOf(d.warehouse_address) }),
    latitude: t.float({ nullable: true, resolve: (d) => d.warehouse_latitude }), longitude: t.float({ nullable: true, resolve: (d) => d.warehouse_longitude }),
  }) })
  const Line = builder.objectRef<RiderDeliveryView['lines'][number]>('DeliveryLine').implement({ fields: (t) => ({
    name: t.exposeString('name'), versionName: t.exposeString('version_name', { nullable: true }), quantity: t.exposeInt('quantity'),
  }) })
  const Customer = builder.objectRef<CarriedCustomer>('DeliveryCustomer').implement({ fields: (t) => ({
    name: t.exposeString('name', { nullable: true }), phone: t.exposeString('phone', { nullable: true }), note: t.exposeString('note', { nullable: true }),
    address: t.field({ type: Address, resolve: (c) => c.address }),
    latitude: t.exposeFloat('latitude', { nullable: true }), longitude: t.exposeFloat('longitude', { nullable: true }),
  }) })
  // Never the handover code: the rider is told it at the door (DELIVERY §3).
  const Delivery = builder.objectRef<Row>('RiderDelivery').implement({ fields: (t) => ({
    id: t.exposeID('id'), state: t.field({ type: State, resolve: (d) => d.state as (typeof deliveryStates)[number] }),
    area: t.exposeString('area', { nullable: true }), currency: t.exposeString('currency'),
    cashDueAmount: t.exposeString('cash_due_amount', { nullable: true, description: 'Minor units of `currency`, for cash on delivery.' }),
    feeAmount: t.exposeString('fee_amount', { nullable: true, description: 'Minor units of `currency`: the delivery fee the customer paid.' }),
    warehouse: t.field({ type: Warehouse, resolve: (d) => d }),
    lines: t.field({ type: [Line], resolve: (d) => d.lines ?? [] }),
    customer: t.field({ type: Customer, nullable: true, resolve: (d) => d.customer ?? null }),
    failedReason: t.exposeString('failed_reason', { nullable: true }),
    createdAt: t.string({ resolve: (d) => d.created_at.toISOString() }),
    assignedAt: t.string({ nullable: true, resolve: (d) => iso(d.assigned_at) }), pickedUpAt: t.string({ nullable: true, resolve: (d) => iso(d.picked_up_at) }),
    deliveredAt: t.string({ nullable: true, resolve: (d) => iso(d.delivered_at) }), failedAt: t.string({ nullable: true, resolve: (d) => iso(d.failed_at) }),
  }) })
  const Info = builder.objectRef<Listed['pageInfo']>('RiderDeliveryPageInfo').implement({ fields: (t) => ({
    startCursor: t.exposeString('startCursor', { nullable: true }), endCursor: t.exposeString('endCursor', { nullable: true }),
    hasPreviousPage: t.exposeBoolean('hasPreviousPage'), hasNextPage: t.exposeBoolean('hasNextPage'),
  }) })
  const Deliveries = builder.objectRef<Listed>('RiderDeliveryPage').implement({ fields: (t) => ({
    nodes: t.field({ type: [Delivery], resolve: (p) => p.nodes }), pageInfo: t.field({ type: Info, resolve: (p) => p.pageInfo }),
    deliveredToday: t.exposeInt('deliveredToday'), deliveredThisWeek: t.exposeInt('deliveredThisWeek'),
  }) })

  builder.queryFields((t) => ({
    delivery: t.field({ type: Delivery, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access },
      resolve: (_, a, c) => withDispatchCode(() => service(c).delivery(String(a.id).toLowerCase())) }),
    deliveries: t.field({
      type: Deliveries, args: { state: t.arg({ type: [State] }), first: t.arg.int(), after: t.arg.string() }, extensions: { access },
      resolve: async (_, args, ctx) => {
        const p = pageWindow({ first: args.first ?? 20, after: args.after }, 50)
        if (!p.ok) throw new GraphQLError('That page link is invalid.', { extensions: { code: p.code } })
        const { rows, counts } = await withDispatchCode(() => service(ctx).deliveries(args.state ?? null, p.window))
        return { ...pageOf<Row>(rows, p.window, (d) => ({ id: d.id, occurredAt: d.created_at })), deliveredToday: counts.today, deliveredThisWeek: counts.week }
      },
    }),
  }))
  builder.mutationFields((t) => ({
    handBack: t.boolean({ args: { id: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.handedBack } },
      resolve: (_, a, c) => withDispatchCode(() => service(c).handBack(String(a.id).toLowerCase())) }),
    markPickedUp: t.boolean({ args: { id: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: carryAudit.pickedUp } },
      resolve: (_, a, c) => withDispatchCode(() => service(c).pickUp(String(a.id).toLowerCase())) }),
    markDelivered: t.boolean({
      args: { id: t.arg.id({ required: true }), code: t.arg.string({ required: true }), cashCollected: t.arg.boolean(), at: t.arg.string({ required: true }), key: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: carryAudit.delivered } },
      resolve: (_, a, c) => withDispatchCode(() => service(c).delivered({ id: String(a.id).toLowerCase(), code: a.code, cashCollected: a.cashCollected ?? null, at: a.at, key: a.key })),
    }),
    markFailed: t.boolean({
      args: { id: t.arg.id({ required: true }), reason: t.arg({ type: FailReason, required: true }), note: t.arg.string(), at: t.arg.string({ required: true }), key: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: carryAudit.failed } },
      resolve: (_, a, c) => withDispatchCode(() => service(c).failed({ id: String(a.id).toLowerCase(), reason: a.reason, note: a.note ?? null, at: a.at, key: a.key })),
    }),
  }))
}
