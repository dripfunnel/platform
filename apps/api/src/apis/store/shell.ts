import { GraphQLError } from 'graphql'
import { isMerchantRole, isSupplierRole, isSupplierTier, storePermissions, storeRoleHas, type StoreRole } from '#auth/storePermissions'
import { recordCrossing } from '#auth/storeCaller'
import { selectMemberships } from '#db/scoped/storeCaller'
import { pageOf } from '#core/paging'
import { withScope, withSystemScope } from '#db/scoped/index'
import { selectPortalBrand } from '#db/scoped/portalBrand'
import { selectMyMemberships, selectOpenSupportSession, selectStoreState, type MembershipChoiceRow } from '#db/scoped/storeShell'
import { selectOpenStoreSupportSession, type StoreSupportRow } from '#db/scoped/storeSupport'
import { writeRequestOf } from '#saas/storeSupport/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, readOnlyFor, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// The portal's shell (FIRST-RELEASE §3, §19; #290): the brand before sign-in, who is signed in and
// as what, the stores they may act in, and the acting store's state for the banners. A supplier's
// is masked to what the shell needs: never the plan, trial or billing state (§19).

export const brandFiles = { 'logo-light': 'logo_light_key', 'logo-dark': 'logo_dark_key', mark: 'mark_key', favicon: 'favicon_key' } as const
export type BrandFile = keyof typeof brandFiles

interface Brand {
  productName: string
  primaryColor: string | null
  accentColor: string | null
  font: string | null
  corner: string | null
  background: string | null
  files: Record<BrandFile, string | null>
  supportEmail: string | null
  supportUrl: string | null
  helpUrl: string | null
  termsUrl: string | null
  privacyUrl: string | null
  poweredBy: boolean
}

interface Choice {
  membershipId: string
  storeId: string
  storeName: string
  role: StoreRole
  sellerId: string | null
  sellerName: string | null
}

const roleOf = (row: MembershipChoiceRow): StoreRole | null => {
  if (row.seller_id === null) return isMerchantRole(row.role_key) ? { side: 'merchant', role: row.role_key } : null
  return isSupplierRole(row.role_key) && row.access_level !== null && isSupplierTier(row.access_level) ? { side: 'supplier', role: row.role_key, tier: row.access_level } : null
}

const choiceOf = (row: MembershipChoiceRow): Choice | null => {
  const role = roleOf(row)
  return role ? { membershipId: row.membership_id, storeId: row.store_id, storeName: row.store_name, role, sellerId: row.seller_id, sellerName: row.seller_name } : null
}

const roleName = (role: StoreRole) => role.role
const tierOf = (role: StoreRole) => (role.side === 'supplier' ? role.tier : null)

interface Banner {
  partnerName: string
  agentFirstName: string
  endsAt: string
  /** The merchant side's only: what Allow / Deny answers (ACCESS.md §8). */
  sessionId: string | null
  access: string | null
  allowedBy: string | null
  writeRequest: { note: string; requestedAt: string; state: string } | null
}

/** What the support banner shows (0036): the partner, the agent's first name and when the session ends. */
const bannerOf = (s: { partner_name: string; agent_name: string; expires_at: Date }): Banner => ({
  partnerName: s.partner_name,
  agentFirstName: s.agent_name.split(' ')[0] ?? s.agent_name,
  endsAt: s.expires_at.toISOString(),
  sessionId: null,
  access: null,
  allowedBy: null,
  writeRequest: null,
})

/** The merchant side's banner (0160), with the agent's request for writes to Allow or Deny. */
const merchantBannerOf = (s: StoreSupportRow): Banner => {
  const asked = writeRequestOf(s)
  return {
    ...bannerOf(s),
    sessionId: s.id,
    access: s.access,
    allowedBy: s.access === 'write' ? s.write_decided_by_name : null,
    writeRequest: asked && { ...asked, requestedAt: asked.requestedAt.toISOString() },
  }
}

export const registerShell = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)

  const BrandFiles = builder.objectRef<Brand['files']>('BrandFiles').implement({
    fields: (t) => ({
      logoLight: t.string({ nullable: true, resolve: (f) => f['logo-light'] }),
      logoDark: t.string({ nullable: true, resolve: (f) => f['logo-dark'] }),
      mark: t.string({ nullable: true, resolve: (f) => f.mark }),
      favicon: t.string({ nullable: true, resolve: (f) => f.favicon }),
    }),
  })

  const BrandType = builder.objectRef<Brand>('Brand').implement({
    fields: (t) => ({
      productName: t.exposeString('productName'),
      primaryColor: t.exposeString('primaryColor', { nullable: true }),
      accentColor: t.exposeString('accentColor', { nullable: true }),
      font: t.exposeString('font', { nullable: true }),
      corner: t.exposeString('corner', { nullable: true }),
      background: t.exposeString('background', { nullable: true }),
      files: t.field({ type: BrandFiles, resolve: (b) => b.files }),
      supportEmail: t.exposeString('supportEmail', { nullable: true }),
      supportUrl: t.exposeString('supportUrl', { nullable: true }),
      helpUrl: t.exposeString('helpUrl', { nullable: true }),
      termsUrl: t.exposeString('termsUrl', { nullable: true }),
      privacyUrl: t.exposeString('privacyUrl', { nullable: true }),
      poweredBy: t.exposeBoolean('poweredBy'),
    }),
  })

  const Named = builder.objectRef<{ id: string; name: string }>('Named').implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) })

  const ChoiceType = builder.objectRef<Choice>('StoreChoice').implement({
    fields: (t) => ({
      membershipId: t.exposeID('membershipId'),
      store: t.field({ type: Named, resolve: (c) => ({ id: c.storeId, name: c.storeName }) }),
      role: t.string({ resolve: (c) => roleName(c.role) }),
      tier: t.string({ nullable: true, resolve: (c) => tierOf(c.role) }),
      seller: t.field({ type: Named, nullable: true, resolve: (c) => (c.sellerId && c.sellerName ? { id: c.sellerId, name: c.sellerName } : null) }),
    }),
  })

  const Choices = builder.objectRef<{ nodes: Choice[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('StoreChoices').implement({
    fields: (t) => ({ nodes: t.field({ type: [ChoiceType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })

  interface Acting {
    store: { id: string; name: string }
    role: StoreRole
    seller: { id: string; name: string } | null
    plan: { id: string; name: string } | null
  }
  const ActingType = builder.objectRef<Acting>('ActingStore').implement({
    fields: (t) => ({
      store: t.field({ type: Named, resolve: (a) => a.store }),
      role: t.string({ resolve: (a) => roleName(a.role) }),
      tier: t.string({ nullable: true, resolve: (a) => tierOf(a.role) }),
      seller: t.field({ type: Named, nullable: true, resolve: (a) => a.seller }),
      // A supplier never reads the store's plan (FIRST-RELEASE §19).
      plan: t.field({ type: Named, nullable: true, resolve: (a) => (a.role.side === 'merchant' ? a.plan : null) }),
      permissions: t.stringList({ resolve: (a) => storePermissions.filter((p) => storeRoleHas(a.role, p)) }),
    }),
  })

  interface MeShape {
    id: string
    name: string
    email: string
    acting: Acting | null
  }
  const MeType = builder.objectRef<MeShape>('Me').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      email: t.exposeString('email'),
      acting: t.field({ type: ActingType, nullable: true, resolve: (m) => m.acting }),
    }),
  })

  interface StateShape {
    readOnly: boolean
    status: string | null
    trialEndsAt: string | null
    pastDueSince: string | null
    provisioning: { state: string; step: string } | null
    support: Banner | null
  }
  const Provisioning = builder.objectRef<NonNullable<StateShape['provisioning']>>('Provisioning').implement({ fields: (t) => ({ state: t.exposeString('state'), step: t.exposeString('step') }) })
  const WriteRequest = builder.objectRef<NonNullable<Banner['writeRequest']>>('SupportWriteRequest').implement({
    // pending, allowed or denied
    fields: (t) => ({ note: t.exposeString('note'), requestedAt: t.exposeString('requestedAt'), state: t.exposeString('state') }),
  })
  const Support = builder.objectRef<Banner>('SupportBanner').implement({
    fields: (t) => ({
      partnerName: t.exposeString('partnerName'),
      agentFirstName: t.exposeString('agentFirstName'),
      endsAt: t.exposeString('endsAt'),
      sessionId: t.exposeID('sessionId', { nullable: true }),
      // read or write
      access: t.exposeString('access', { nullable: true }),
      allowedBy: t.exposeString('allowedBy', { nullable: true }),
      writeRequest: t.field({ type: WriteRequest, nullable: true, resolve: (b) => b.writeRequest }),
    }),
  })
  const StateType = builder.objectRef<StateShape>('StoreState').implement({
    fields: (t) => ({
      readOnly: t.exposeBoolean('readOnly'),
      status: t.exposeString('status', { nullable: true }),
      trialEndsAt: t.exposeString('trialEndsAt', { nullable: true }),
      pastDueSince: t.exposeString('pastDueSince', { nullable: true }),
      provisioning: t.field({ type: Provisioning, nullable: true, resolve: (s) => s.provisioning }),
      support: t.field({ type: Support, nullable: true, resolve: (s) => s.support }),
    }),
  })

  const sqlOf = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    return ctx.sql
  }

  builder.queryFields((t) => ({
    // Public: the sign-in screen draws the partner's look before anyone signs in (FIRST-RELEASE §4).
    brand: t.field({
      type: BrandType,
      nullable: true,
      extensions: { access: { api: 'store', scope: 'public', permission: null } },
      resolve: async (_, __, ctx) => {
        if (!ctx.sql || !ctx.partnerId) return null
        const partnerId = ctx.partnerId
        const row = await withSystemScope(ctx.sql, (tx) => selectPortalBrand(tx, partnerId, ctx.now()))
        if (!row) return null
        const file = (f: BrandFile) => (row[brandFiles[f]] ? `/api/brand/${f}` : null)
        return {
          productName: row.product_name ?? row.partner_name,
          primaryColor: row.primary_color,
          accentColor: row.accent_color,
          font: row.font,
          corner: row.corner,
          background: row.background,
          files: { 'logo-light': file('logo-light'), 'logo-dark': file('logo-dark'), mark: file('mark'), favicon: file('favicon') },
          supportEmail: row.support_email,
          supportUrl: row.support_url,
          helpUrl: row.help_url,
          termsUrl: row.terms_url,
          privacyUrl: row.privacy_url,
          poweredBy: row.powered_by,
        }
      },
    }),
    // Null when signed out, so the portal knows to show sign-in rather than an error.
    me: t.field({
      type: MeType,
      nullable: true,
      extensions: { access: { api: 'store', scope: 'public', permission: null } },
      resolve: (_, __, { standing }) => {
        if (standing.kind === 'signed-out') return null
        const { person } = standing
        const acting = standing.kind === 'acting' ? { store: { id: standing.caller.store.id, name: standing.caller.store.name }, role: standing.caller.role, seller: standing.caller.seller, plan: standing.caller.plan } : null
        return { id: person.id, name: person.name, email: person.email, acting }
      },
    }),
    myStores: t.field({
      type: Choices,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: { api: 'store', scope: 'session', permission: null } },
      resolve: async (_, args, ctx) => {
        const { standing } = ctx
        if (standing.kind === 'signed-out') throw forbidden()
        const window = storePage(args)
        const rows = await withSystemScope(sqlOf(ctx), (tx) => selectMyMemberships(tx, standing.person.id, standing.person.partnerId, window))
        const page = pageOf(rows, window, (r) => ({ occurredAt: r.created_at, id: r.membership_id }))
        return { nodes: page.nodes.map(choiceOf).filter((c): c is Choice => c !== null), pageInfo: page.pageInfo }
      },
    }),
    storeState: t.field({
      type: StateType,
      extensions: { access: { api: 'store', scope: 'store-seller', permission: 'catalog.read', target: 'none' } },
      resolve: async (_, __, ctx) => {
        const caller = actingCaller(ctx)
        const sql = sqlOf(ctx)
        // A supplier hears whether the store is read-only and who from support is in it (§19 "masked"), so it
        // reads nothing of the store row: the support banner comes from its definer function (0036).
        if (caller.role.side !== 'merchant') {
          const open = await withScope(sql, caller.context, (tx) => selectOpenSupportSession(tx, ctx.now()))
          return { readOnly: readOnlyFor(caller.role, caller.store.status), status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: open ? bannerOf(open) : null }
        }
        const { row, support } = await withScope(sql, caller.context, async (tx) => ({
          row: await selectStoreState(tx, caller.store.id),
          support: await selectOpenStoreSupportSession(tx, ctx.now()),
        }))
        const status = row?.status ?? caller.store.status
        return {
          readOnly: readOnlyFor(caller.role, status),
          status,
          trialEndsAt: row?.trial_ends_at ? row.trial_ends_at.toISOString() : null,
          pastDueSince: row?.past_due_since ? row.past_due_since.toISOString() : null,
          provisioning: row?.job_state && row.job_step && row.job_state !== 'done' ? { state: row.job_state, step: row.job_step } : null,
          support: support ? merchantBannerOf(support) : null,
        }
      },
    }),
  }))

  builder.mutationFields((t) => ({
    // The chooser's answer (ACCESS.md §4): confirms the person holds it and records the switch;
    // the portal then names it in `X-Store` (and `X-Supplier`) on every request.
    switchStore: t.field({
      type: ChoiceType,
      args: { storeId: t.arg.id({ required: true }), supplierId: t.arg.id() },
      extensions: { access: { api: 'store', scope: 'session', permission: null, audit: 'person.switched_store', whileReadOnly: true } },
      resolve: async (_, { storeId, supplierId }, ctx) => {
        const { standing } = ctx
        if (standing.kind === 'signed-out') throw forbidden()
        const person = standing.person
        const sql = sqlOf(ctx)
        // Null is a store not held: logged as a crossing in this transaction, refused once it commits.
        const switched = await withSystemScope(sql, async (tx): Promise<Choice | null> => {
          const memberships = /^[0-9a-f-]{36}$/i.test(String(storeId)) ? await selectMemberships(tx, person.id, person.partnerId, String(storeId)) : []
          if (memberships.length === 0) {
            await recordCrossing(tx, person, String(storeId), ctx.activity, ctx.facts, ctx.now())
            return null
          }
          const row = supplierId ? memberships.find((m) => m.seller_id === supplierId) : memberships.length === 1 ? memberships[0] : undefined
          if (!row && memberships.length > 1 && !supplierId) throw new GraphQLError('Choose which supplier you are acting for.', { extensions: { code: 'SUPPLIER_REQUIRED' } })
          const choice = row ? choiceOf({ membership_id: row.membership_id, store_id: row.store_id, store_name: row.store_name, role_key: row.role_key, seller_id: row.seller_id, seller_name: row.seller_name, access_level: row.access_level, created_at: new Date() }) : null
          if (!choice) throw forbidden()
          await ctx.activity.record(tx, {
            category: 'auth',
            action: 'person.switched_store',
            result: 'success',
            actorKind: 'person',
            actorId: person.id,
            actorLabel: null,
            partnerId: person.partnerId,
            storeId: choice.storeId,
            sellerId: choice.sellerId,
            target: { type: 'store', id: choice.storeId, label: choice.storeName },
            reason: null,
            api: 'store',
            visibility: 'self',
            ...ctx.facts,
          })
          return choice
        })
        if (!switched) throw forbidden()
        return switched
      },
    }),
  }))
}
