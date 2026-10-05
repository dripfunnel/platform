import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import type { SupplierFilter, SupplierRow } from '#db/scoped/suppliers'
import { createStoreSuppliersService, suppliersAudit, type SuppliersResult } from '#saas/storeSuppliers/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Settings › Supplier (ACCESS §5.2, §7.5; SetTeam): the Owner's (`manage-vendors`); the rules are
// saas/storeSuppliers', this file authorises, calls and words the refusals.

const words: Record<Exclude<SuppliersResult<unknown>, { ok: true }>['reason'], string> = {
  NOT_FOUND: 'That supplier is no longer here.',
  INVALID_INPUT: 'Something here isn’t valid.',
  INVALID_EMAIL: 'That doesn’t look like an email address.',
  DUPLICATE_SUPPLIER: 'That company is already one of your suppliers.',
  ALREADY_MEMBER: 'They already work in this store, so they can’t be a supplier here too.',
  NOT_SUSPENDED: 'That supplier isn’t suspended.',
  ALREADY_SUSPENDED: 'That supplier is already suspended.',
  RATE_LIMITED: 'Too many invitations for now. Try again later.',
  PLAN_LIMIT: 'Your plan doesn’t include more suppliers.',
}

const answered = <T>(result: SuppliersResult<T>): T => {
  if (result.ok) return result.value
  const facts = result.reason === 'PLAN_LIMIT' ? { key: result.limit.key, limit: result.limit.limit, unlockedBy: result.limit.unlockedBy } : result.reason === 'RATE_LIMITED' ? { per: result.per } : {}
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason, ...facts } })
}

const filters: readonly SupplierFilter[] = ['all', 'active', 'suspended']

export const registerSuppliers = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    return createStoreSuppliersService({ sql: ctx.sql, caller: actingCaller(ctx), activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  const SupplierType = builder.objectRef<SupplierRow>('Supplier').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      // vendor-stock | vendor-catalogue | vendor-orders-read | vendor-orders-fulfil (ACCESS §5.2).
      accessLevel: t.exposeString('access_level'),
      // to-store | to-shopper; labelAccount is who books a to-shopper supplier's labels: store | own.
      shippingMode: t.exposeString('shipping_mode'),
      labelAccount: t.exposeString('label_account'),
      // invited (nobody has joined yet) | active | suspended.
      status: t.exposeString('status'),
      hideProductsWhileSuspended: t.exposeBoolean('hide_products_while_suspended', { nullable: true }),
      suspendedAt: t.string({ nullable: true, resolve: (s) => s.suspended_at?.toISOString() ?? null }),
      users: t.exposeInt('users'),
      products: t.exposeInt('products'),
      createdAt: t.string({ resolve: (s) => s.created_at.toISOString() }),
    }),
  })
  const SupplierPage = builder.objectRef<{ nodes: SupplierRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('SupplierPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [SupplierType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Counts = builder.objectRef<{ all: number; active: number; suspended: number }>('SupplierCounts').implement({
    fields: (t) => ({ all: t.exposeInt('all'), active: t.exposeInt('active'), suspended: t.exposeInt('suspended') }),
  })
  const InviteInput = builder.inputType('InviteSupplierInput', {
    fields: (t) => ({ name: t.string({ required: true }), email: t.string({ required: true }), accessLevel: t.string({ required: true }), shippingMode: t.string(), labelAccount: t.string() }),
  })

  const vendors = { api: 'store', scope: 'store', permission: 'manage-vendors', target: 'none' } as const

  builder.queryFields((t) => ({
    suppliers: t.field({
      type: SupplierPage,
      args: { filter: t.arg.string(), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: vendors },
      resolve: async (_, args, ctx) => {
        const filter = filters.find((f) => f === (args.filter ?? 'all'))
        if (!filter) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
        const window = storePage(args)
        return pageOf(await service(ctx).list(filter, window), window, (s) => ({ occurredAt: s.created_at, id: s.id }))
      },
    }),
    supplierCounts: t.field({ type: Counts, extensions: { access: vendors }, resolve: (_, __, ctx) => service(ctx).counts() }),
    supplier: t.field({ type: SupplierType, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: vendors }, resolve: (_, args, ctx) => service(ctx).one(String(args.id)) }),
  }))

  builder.mutationFields((t) => ({
    // The company and its first user, its Supplier admin, in one; answers the supplier's id.
    inviteSupplier: t.id({
      args: { input: t.arg({ type: InviteInput, required: true }) },
      extensions: { access: { ...vendors, audit: suppliersAudit.invited } },
      resolve: async (_, args, ctx) => answered(await service(ctx).invite(args.input)),
    }),
    setSupplierAccess: t.boolean({
      args: { id: t.arg.id({ required: true }), accessLevel: t.arg.string({ required: true }) },
      extensions: { access: { ...vendors, audit: suppliersAudit.accessChanged } },
      resolve: async (_, args, ctx) => answered(await service(ctx).setAccess(String(args.id), args.accessLevel)),
    }),
    setSupplierShippingMode: t.boolean({
      args: { id: t.arg.id({ required: true }), shippingMode: t.arg.string({ required: true }), labelAccount: t.arg.string() },
      extensions: { access: { ...vendors, audit: suppliersAudit.shippingModeChanged } },
      resolve: async (_, args, ctx) => answered(await service(ctx).setShipping(String(args.id), args.shippingMode, args.labelAccount)),
    }),
    // Answers how many products it hid.
    suspendSupplier: t.int({
      args: { id: t.arg.id({ required: true }), hideProducts: t.arg.boolean({ required: true }) },
      extensions: { access: { ...vendors, audit: suppliersAudit.suspended } },
      resolve: async (_, args, ctx) => answered(await service(ctx).suspend(String(args.id), args.hideProducts)),
    }),
    // Answers how many products came back.
    resumeSupplier: t.int({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...vendors, audit: suppliersAudit.resumed } },
      resolve: async (_, args, ctx) => answered(await service(ctx).resume(String(args.id))),
    }),
    // Answers how many products it hid, kept and still marked as the supplier's.
    removeSupplier: t.int({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...vendors, audit: suppliersAudit.removed } },
      resolve: async (_, args, ctx) => answered(await service(ctx).remove(String(args.id))),
    }),
  }))
}
