import { GraphQLError } from 'graphql'
import { domainAudit, type PartnerDomainsService } from '#saas/partnerDomains/index'
import { builder } from './builder'
import { signedIn } from './fields'

// Domains on the Platform API (ui/platform/FIRST-RELEASE.md §9; card #197). Thin:
// saas/partnerDomains decides, the session's partner is the scope.

type Overview = Awaited<ReturnType<PartnerDomainsService['partnerDomains']>>
type Address = Overview['addresses'][number]
type Record = Extract<Address, { added: true }>['records'][number]
type MerchantPage = NonNullable<Awaited<ReturnType<PartnerDomainsService['merchantDomains']>>>

const RecordType = builder.objectRef<Record>('PartnerDomainRecord').implement({
  fields: (t) => ({
    purpose: t.exposeString('purpose'),
    type: t.exposeString('type'),
    name: t.exposeString('name'),
    value: t.exposeString('value'),
    found: t.exposeString('found', { nullable: true }),
    matches: t.exposeBoolean('matches'),
  }),
})

const AddressType = builder.objectRef<Address>('PartnerAddress').implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    added: t.exposeBoolean('added'),
    host: t.string({ nullable: true, resolve: (a) => (a.added ? a.host : null) }),
    // Where the address's DNS is managed, for "Sign in where you manage DNS for …" (§9.2).
    zone: t.string({ nullable: true, resolve: (a) => (a.added ? a.zone : null) }),
    status: t.string({ nullable: true, resolve: (a) => (a.added ? a.status : null) }),
    since: t.string({ nullable: true, resolve: (a) => (a.added ? a.since.toISOString() : null) }),
    checkedAt: t.string({ nullable: true, resolve: (a) => (a.added ? (a.checkedAt?.toISOString() ?? null) : null) }),
    records: t.field({ type: [RecordType], resolve: (a) => (a.added ? a.records : []) }),
  }),
})

const AddPermission = builder.objectRef<Overview['add']>('PartnerDomainAddPermission').implement({ fields: (t) => ({ allowed: t.exposeBoolean('allowed') }) })

const OverviewType = builder.objectRef<Overview>('PartnerDomains').implement({
  fields: (t) => ({
    addresses: t.field({ type: [AddressType], resolve: (o) => o.addresses }),
    fallbackSender: t.exposeString('fallbackSender', { nullable: true }),
    fallbackAddress: t.exposeString('fallbackAddress', { nullable: true }),
    add: t.field({ type: AddPermission, resolve: (o) => o.add }),
  }),
})

const MerchantDomain = builder.objectRef<MerchantPage['items'][number]>('MerchantDomain').implement({
  fields: (t) => ({
    storeId: t.exposeID('storeId'),
    storeName: t.exposeString('storeName'),
    host: t.exposeString('host'),
    status: t.exposeString('status'),
    since: t.string({ resolve: (d) => d.since.toISOString() }),
  }),
})

const PageInfoType = builder.objectRef<MerchantPage['pageInfo']>('MerchantDomainPageInfo').implement({
  fields: (t) => ({
    hasNextPage: t.exposeBoolean('hasNextPage'),
    hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
    startCursor: t.exposeString('startCursor', { nullable: true }),
    endCursor: t.exposeString('endCursor', { nullable: true }),
  }),
})

const MerchantPageType = builder.objectRef<MerchantPage>('MerchantDomainPage').implement({
  fields: (t) => ({ items: t.field({ type: [MerchantDomain], resolve: (p) => p.items }), pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }) }),
})

type Outcome = { ok: boolean; reason?: string; id?: string; apex?: boolean }
const OutcomeType = builder.objectRef<Outcome>('PartnerDomainResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (o) => o.reason ?? null }),
    id: t.string({ nullable: true, resolve: (o) => o.id ?? null }),
    apex: t.boolean({ nullable: true, resolve: (o) => o.apex ?? null }),
  }),
})

builder.queryFields((t) => ({
  partnerDomains: t.field({
    type: OverviewType,
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'partner.read', target: 'none' } },
    resolve: (_, __, ctx) => signedIn(ctx.domains).partnerDomains(),
  }),
  merchantDomains: t.field({
    type: MerchantPageType,
    args: { after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'partner.read', target: 'none' } },
    resolve: async (_, { after, before, first }, ctx) => {
      const page = await signedIn(ctx.domains).merchantDomains({ after, before, first })
      if (!page) throw new GraphQLError('That page link does not work.', { extensions: { code: 'INVALID_INPUT' } })
      return page
    },
  }),
}))

builder.mutationFields((t) => ({
  addPartnerDomain: t.field({
    type: OutcomeType,
    args: { kind: t.arg.string({ required: true }), host: t.arg.string({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'domains.write', target: 'none', audit: domainAudit.addPartnerDomain } },
    resolve: (_, { kind, host }, ctx) => signedIn(ctx.domains).addPartnerDomain({ kind, host }),
  }),
  removePartnerDomain: t.field({
    type: OutcomeType,
    args: { kind: t.arg.string({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'domains.write', target: 'none', audit: domainAudit.removePartnerDomain } },
    resolve: (_, { kind }, ctx) => signedIn(ctx.domains).removePartnerDomain(kind),
  }),
  recheckPartnerDomain: t.field({
    type: OutcomeType,
    args: { kind: t.arg.string({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'domains.recheck', target: 'none', audit: domainAudit.recheckPartnerDomain } },
    resolve: (_, { kind }, ctx) => signedIn(ctx.domains).recheckPartnerDomain(kind),
  }),
  recheckMerchantDomain: t.field({
    type: OutcomeType,
    args: { storeId: t.arg.id({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'domains.recheck', target: 'none', audit: domainAudit.recheckMerchantDomain } },
    resolve: (_, { storeId }, ctx) => signedIn(ctx.domains).recheckMerchantDomain(String(storeId)),
  }),
}))
