import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import { catalogExportKind } from '#engine/modules/catalog/index'
import {
  createCustomerExportService,
  createCustomersService,
  customerExportAudit,
  customersAudit,
  type CustomerDetailRow,
  type CustomerExportDto,
  type CustomerListRow,
  type CustomersRefusal,
  type CustomersResult,
  type GroupRow,
} from '#engine/modules/customers/index'
import { queueSideEffect } from '#saas/outbox/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, tenantCaller, type StoreContext } from './access'
import { moneyType, pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Customers (FIRST-RELEASE §7, §19; PortalOrders › Customers): the merchant side's, Owner, Manager and Staff alike
// (ACCESS §5.1). "Suppliers never see this list": no supplier role holds a customers permission.

const words: Record<CustomersRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That isn’t here.',
  READ_ONLY: 'A read-only support session can’t change this store.',
  TOO_MANY: 'That’s more than a store can keep.',
  NAME_TAKEN: 'You already have a group with that name.',
  NUMBER_TAKEN: 'Another customer already has that number.',
  VERIFIED: 'The customer confirmed this number themselves, so only they can change it.',
  DELETED: 'That customer deleted their account, so they can’t be added again.',
}

const answered = <T>(result: CustomersResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

export const registerCustomers = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const Money = moneyType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = tenantCaller(ctx)
    return createCustomersService({ sql: ctx.sql, context: caller.context, actor: { id: caller.actor.id, partnerId: caller.actor.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }
  const exportsOf = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createCustomerExportService({
      sql: ctx.sql,
      context: caller.context,
      actor: { id: caller.person.id, label: caller.person.name || caller.person.email, partnerId: caller.person.partnerId },
      activity: ctx.activity,
      facts: ctx.facts,
      now: ctx.now,
      queue: (tx, payload) => queueSideEffect(tx, { kind: catalogExportKind, idempotencyKey: payload.jobId, payload, partnerId: payload.partnerId, storeId: payload.storeId }),
    })
  }
  const at = (value: Date | string | null) => (value ? new Date(value).toISOString() : null)

  const Summary = builder.objectRef<CustomerListRow>('CustomerSummary').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name', { nullable: true }),
      email: t.exposeString('email', { nullable: true }),
      phone: t.exposeString('phone', { nullable: true }),
      // A shopper's own account (signed up or proven); an unverified one was added by the team or by a guest order.
      hasAccount: t.boolean({ resolve: (c) => c.status === 'active' }),
      tags: t.exposeStringList('tags'),
      city: t.exposeString('city', { nullable: true }),
      orders: t.exposeInt('orders'),
      // What they've paid, less refunds, a figure a currency.
      spent: t.field({ type: [Money], resolve: (c) => c.spent }),
      createdAt: t.string({ resolve: (c) => new Date(c.created_at).toISOString() }),
    }),
  })
  const SummaryPage = builder.objectRef<{ nodes: CustomerListRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('CustomerPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Summary], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  type Address = CustomerDetailRow['addresses'][number]
  const AddressType = builder.objectRef<Address>('CustomerAddress').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      line1: t.exposeString('line1'),
      line2: t.exposeString('line2', { nullable: true }),
      city: t.exposeString('city'),
      region: t.exposeString('region', { nullable: true }),
      postalCode: t.exposeString('postalCode', { nullable: true }),
      country: t.exposeString('country'),
      phone: t.exposeString('phone', { nullable: true }),
      isDefault: t.exposeBoolean('isDefault'),
    }),
  })
  type Consent = Pick<CustomerDetailRow, 'consent_state' | 'consent_at' | 'consent_source' | 'consent_channels'>
  const ConsentType = builder.objectRef<Consent>('MarketingConsent').implement({
    fields: (t) => ({
      // opted_in, stopped, declined or not_asked
      state: t.exposeString('consent_state'),
      at: t.string({ nullable: true, resolve: (c) => at(c.consent_at) }),
      // checkout, email, added_by_hand or recorded_by_store
      source: t.exposeString('consent_source', { nullable: true }),
      channels: t.exposeStringList('consent_channels'),
    }),
  })
  type RecentOrder = CustomerDetailRow['recent_orders'][number]
  const RecentOrderType = builder.objectRef<RecentOrder>('CustomerOrder').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      number: t.exposeString('number'),
      placedAt: t.string({ resolve: (o) => new Date(o.placed_at).toISOString() }),
      state: t.exposeString('state'),
      paymentState: t.exposeString('payment_state'),
      fulfilmentState: t.exposeString('fulfilment_state'),
      total: t.field({ type: Money, resolve: (o) => ({ amount: o.total_amount, currency: o.currency }) }),
    }),
  })
  const Customer = builder.objectRef<CustomerDetailRow>('Customer').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name', { nullable: true }),
      email: t.exposeString('email', { nullable: true }),
      phone: t.exposeString('phone', { nullable: true }),
      emailVerified: t.exposeBoolean('email_verified'),
      phoneVerified: t.exposeBoolean('phone_verified'),
      hasAccount: t.boolean({ resolve: (c) => c.status === 'active' }),
      tags: t.exposeStringList('tags'),
      // Only the team sees it.
      note: t.exposeString('note', { nullable: true }),
      consent: t.field({ type: ConsentType, resolve: (c) => c }),
      groupIds: t.idList({ resolve: (c) => c.group_ids }),
      addresses: t.field({ type: [AddressType], resolve: (c) => c.addresses }),
      city: t.exposeString('city', { nullable: true }),
      ordersCount: t.exposeInt('orders'),
      // The newest 20; the rest are in Orders.
      orders: t.field({ type: [RecentOrderType], resolve: (c) => c.recent_orders }),
      spent: t.field({ type: [Money], resolve: (c) => c.spent }),
      createdAt: t.string({ resolve: (c) => new Date(c.created_at).toISOString() }),
    }),
  })
  const Group = builder.objectRef<GroupRow>('CustomerGroup').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      description: t.exposeString('description', { nullable: true }),
      members: t.exposeInt('members'),
    }),
  })
  const Added = builder.objectRef<{ id: string; existed: boolean }>('AddedCustomer').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // Already a customer with that email: the screen opens them instead.
      existed: t.exposeBoolean('existed'),
    }),
  })
  const CustomerExport = builder.objectRef<CustomerExportDto>('CustomerExport').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // queued, done, failed or expired
      state: t.exposeString('state'),
      rows: t.exposeInt('rows', { nullable: true }),
      truncated: t.exposeBoolean('truncated'),
      csv: t.exposeString('csv', { nullable: true }),
      requestedAt: t.string({ resolve: (e) => e.requestedAt.toISOString() }),
      expiresAt: t.string({ nullable: true, resolve: (e) => e.expiresAt?.toISOString() ?? null }),
    }),
  })
  const AddressInput = builder.inputType('CustomerAddressInput', {
    fields: (t) => ({
      name: t.string({ required: true }),
      line1: t.string({ required: true }),
      line2: t.string(),
      city: t.string({ required: true }),
      region: t.string(),
      postalCode: t.string(),
      country: t.string({ required: true }),
      phone: t.string(),
    }),
  })

  const read = { api: 'store', scope: 'store', permission: 'customers.read', target: 'none' } as const
  const write = (audit: string) => ({ api: 'store', scope: 'store', permission: 'customers.write', target: 'none', audit }) as const

  builder.queryFields((t) => ({
    customers: t.field({
      type: SummaryPage,
      args: { groupId: t.arg.id(), search: t.arg.string(), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: { ...read, machine: true } },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        const filter = { groupId: args.groupId ? String(args.groupId).toLowerCase() : null, search: args.search ?? null }
        return pageOf(await service(ctx).list(filter, window), window, (c) => ({ occurredAt: new Date(c.created_at), id: c.id }))
      },
    }),
    // "People · n" on the tab.
    customerCount: t.int({ extensions: { access: { ...read, machine: true } }, resolve: (_, __, ctx) => service(ctx).count() }),
    customer: t.field({ type: Customer, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: { ...read, machine: true } }, resolve: (_, args, ctx) => service(ctx).detail(String(args.id).toLowerCase()) }),
    customerGroups: t.field({ type: [Group], extensions: { access: { ...read, machine: true } }, resolve: (_, __, ctx) => service(ctx).groups() }),
    customerExport: t.field({
      type: CustomerExport,
      nullable: true,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...read, permission: 'customers.export' } },
      resolve: (_, { id }, ctx) => exportsOf(ctx).read(String(id)),
    }),
    customerExports: t.field({ type: [CustomerExport], extensions: { access: { ...read, permission: 'customers.export' } }, resolve: (_, __, ctx) => exportsOf(ctx).recent() }),
  }))

  builder.mutationFields((t) => ({
    addCustomer: t.field({
      type: Added,
      args: { name: t.arg.string({ required: true }), email: t.arg.string({ required: true }), phone: t.arg.string() },
      extensions: { access: write(customersAudit.added) },
      resolve: async (_, args, ctx) => answered(await service(ctx).add({ name: args.name, email: args.email, phone: args.phone ?? null })),
    }),
    // Past orders keep the details they were placed with; the address is the customer's default.
    updateCustomer: t.boolean({
      args: { id: t.arg.id({ required: true }), name: t.arg.string(), phone: t.arg.string(), address: t.arg({ type: AddressInput }) },
      extensions: { access: write(customersAudit.edited) },
      resolve: async (_, args, ctx) => answered(await service(ctx).edit(String(args.id).toLowerCase(), { name: args.name, phone: args.phone, address: args.address })),
    }),
    setCustomerTags: t.stringList({
      args: { id: t.arg.id({ required: true }), tags: t.arg.stringList({ required: true }) },
      extensions: { access: write(customersAudit.tagsChanged) },
      resolve: async (_, args, ctx) => answered(await service(ctx).setTags(String(args.id).toLowerCase(), args.tags)),
    }),
    setCustomerNote: t.boolean({
      args: { id: t.arg.id({ required: true }), note: t.arg.string() },
      extensions: { access: write(customersAudit.noteChanged) },
      resolve: async (_, args, ctx) => answered(await service(ctx).setNote(String(args.id).toLowerCase(), args.note ?? null)),
    }),
    // When they ask the team directly; order and delivery emails still go to them.
    recordMarketingStop: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: write(customersAudit.consentRecorded) },
      resolve: async (_, args, ctx) => answered(await service(ctx).recordStop(String(args.id).toLowerCase())),
    }),
    // The customer page's group chips: the groups become exactly these.
    setCustomerGroups: t.idList({
      args: { id: t.arg.id({ required: true }), groupIds: t.arg.idList({ required: true }) },
      extensions: { access: write(customersAudit.groupsChanged) },
      resolve: async (_, args, ctx) => answered(await service(ctx).setGroups(String(args.id).toLowerCase(), args.groupIds.map(String))),
    }),
    createGroup: t.id({
      args: { name: t.arg.string({ required: true }), description: t.arg.string() },
      extensions: { access: write(customersAudit.groupCreated) },
      resolve: async (_, args, ctx) => answered(await service(ctx).createGroup({ name: args.name, description: args.description })),
    }),
    updateGroup: t.boolean({
      args: { id: t.arg.id({ required: true }), name: t.arg.string({ required: true }), description: t.arg.string() },
      extensions: { access: write(customersAudit.groupUpdated) },
      resolve: async (_, args, ctx) => answered(await service(ctx).updateGroup(String(args.id).toLowerCase(), { name: args.name, description: args.description })),
    }),
    // Its members leave it; the screen says how many first (customerGroups' members).
    deleteGroup: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: write(customersAudit.groupDeleted) },
      resolve: async (_, args, ctx) => answered(await service(ctx).deleteGroup(String(args.id).toLowerCase())),
    }),
    // A job: the file is read back with customerExport(id). An export is a read, so a read-only store allows it.
    exportCustomers: t.id({
      args: { groupId: t.arg.id(), search: t.arg.string() },
      extensions: { access: { ...read, permission: 'customers.export', whileReadOnly: true, audit: customerExportAudit } },
      resolve: async (_, args, ctx) => {
        // A read-only support session reads the store's screens, never takes its data away (ACCESS §8).
        const { caller } = actingCaller(ctx).context
        if (caller.kind === 'support' && caller.access === 'read') throw forbidden()
        const result = await exportsOf(ctx).request({ groupId: args.groupId ? String(args.groupId).toLowerCase() : null, search: args.search ?? null })
        if (!result.ok) throw new GraphQLError('That filter doesn’t work.', { extensions: { code: result.reason } })
        return result.jobId
      },
    }),
  }))
}
