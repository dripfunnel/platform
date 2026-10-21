import { GraphQLError } from 'graphql'
import type { CustomerDetailDto, CustomerPageDto, CustomerRowDto } from '#saas/customers/index'
import { builder } from './builder'
import { iso, PageInfoType, signedIn } from './types'

// Customers on the Admin API (ui/admin/FIRST-RELEASE.md §5.4; card #36). Read-only: no mutation.
// No type here carries an address, an order's contents, a payment detail, a password or a link
// to an account in another store; a schema test holds that.

type Common = CustomerRowDto | CustomerDetailDto

const Named = builder.objectRef<{ id: string; name: string }>('CustomerPlace').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
})

const common = builder.interfaceRef<Common>('CustomerAccount').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name', { nullable: true }),
    // Masked in the list for every role (§5.4), and on the detail for a role without contact access.
    email: t.exposeString('email', { nullable: true }),
    phone: t.exposeString('phone', { nullable: true }),
    phoneRegion: t.exposeString('phoneRegion', { nullable: true }),
    store: t.field({ type: Named, resolve: (c) => c.store }),
    partner: t.field({ type: Named, resolve: (c) => c.partner }),
    signsInWith: t.exposeString('signsInWith', { nullable: true }),
    status: t.exposeString('status'),
    orders: t.int({ nullable: true, resolve: (c) => c.orders }),
    createdAt: t.string({ resolve: (c) => c.createdAt.toISOString() }),
    lastSignInAt: t.string({ nullable: true, resolve: (c) => iso(c.lastSignInAt) }),
  }),
})

const Row = builder.objectRef<CustomerRowDto>('CustomerRow').implement({ interfaces: [common], isTypeOf: (v) => typeof v === 'object' && v !== null && !('contactsMasked' in v) })

const Suspension = builder.objectRef<NonNullable<CustomerDetailDto['storeSuspension']>>('CustomerStoreSuspension').implement({
  fields: (t) => ({ reason: t.exposeString('reason') }),
})

const Detail = builder.objectRef<CustomerDetailDto>('Customer').implement({
  interfaces: [common],
  isTypeOf: (v) => typeof v === 'object' && v !== null && 'contactsMasked' in v,
  fields: (t) => ({
    emailVerified: t.exposeBoolean('emailVerified'),
    phoneVerified: t.exposeBoolean('phoneVerified'),
    contactsMasked: t.exposeBoolean('contactsMasked'),
    deletedAt: t.string({ nullable: true, resolve: (c) => c.deletedAt }),
    storeSuspension: t.field({ type: Suspension, nullable: true, resolve: (c) => c.storeSuspension }),
  }),
})

const Match = builder.objectRef<NonNullable<CustomerPageDto['match']>>('CustomerMatch').implement({
  fields: (t) => ({ kind: t.exposeString('kind'), accounts: t.exposeInt('accounts'), regions: t.exposeStringList('regions') }),
})

const Page = builder.objectRef<CustomerPageDto>('CustomerPage').implement({
  fields: (t) => ({
    items: t.field({ type: [Row], resolve: (p) => p.items }),
    pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }),
    match: t.field({ type: Match, nullable: true, resolve: (p) => p.match }),
    partners: t.field({ type: [Named], resolve: (p) => p.partners }),
    stores: t.field({ type: [Named], resolve: (p) => p.stores }),
  }),
})

const Filter = builder.inputType('CustomerFilter', {
  fields: (t) => ({ partner: t.id(), store: t.id(), status: t.string(), via: t.string(), created: t.string(), lastSignIn: t.string() }),
})

const read = { api: 'admin', scope: 'platform', permission: 'customers.read', target: 'none' } as const
const present = (o: Record<string, unknown> | null | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== null && v !== undefined))

builder.queryFields((t) => ({
  customers: t.field({
    type: Page,
    // `search`: name, exact email or exact phone, as a variable in the request body, never a URL (§5.4).
    args: { filter: t.arg({ type: Filter }), search: t.arg.string(), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: read },
    resolve: async (_, { filter, search, after, before, first }, ctx) => {
      const page = await signedIn(ctx.customers).customers(present(filter), search ?? null, { after, before, first })
      if (!page) throw new GraphQLError('That filter, search or page link does not work.', { extensions: { code: 'INVALID_INPUT' } })
      return page
    },
  }),
  customer: t.field({ type: Detail, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: read }, resolve: (_, { id }, ctx) => signedIn(ctx.customers).customer(String(id)) }),
}))
