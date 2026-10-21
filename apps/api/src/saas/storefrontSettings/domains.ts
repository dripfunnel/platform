import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { parseHostname } from '#core/hostname'
import type { TenantContext } from '#core/tenancy'
import type { CustomDomainRow } from '#db/schema/saas'
import { serialise, uniqueViolation, withScope, type ScopedSql } from '#db/scoped/index'
import { insertCustomDomain } from '#db/scoped/stores'
import { deleteStoreDomain, merchantHostTaken, selectStoreDomainForUpdate, selectStoreDomains, selectStoreSlug, setPrimaryDomain } from '#db/scoped/storefrontSettings'
import { edgeTargets, isBareDomain, isDripfunnelHost, queueHostPurge, queueMerchantDomainRemoval, type MerchantHost } from '#saas/domains/index'
import { planLimitFor } from '#saas/entitlements/index'
import { queueSideEffect } from '#saas/outbox/index'

// Site settings › Domains (PortalStorefront; SAAS §8 "The merchant's side"): the free address always works, one domain of
// the merchant's own on a plan with `custom_domain`, one waiting at a time, checked only by the outbox's deliverer.

export const domainAudit = {
  connected: 'custom_domain.connected',
  checkRequested: 'custom_domain.check_requested',
  madePrimary: 'custom_domain.made_primary',
  removed: 'custom_domain.removed',
} as const

export type DomainRefusal =
  | { reason: 'INVALID_HOSTNAME' }
  | { reason: 'APEX_NOT_AVAILABLE'; suggested: string }
  | { reason: 'DRIPFUNNEL_DOMAIN' }
  | { reason: 'DOMAIN_TAKEN' }
  | { reason: 'DOMAIN_PENDING' }
  | { reason: 'DOMAIN_LIMIT' }
  | { reason: 'DOMAIN_NOT_LIVE' }
  | { reason: 'TOO_SOON' }
  | { reason: 'NOT_FOUND' }
export type DomainResult<T> = { ok: true; value: T } | ({ ok: false } & DomainRefusal)

export interface DomainView {
  id: string | null
  host: string
  kind: 'free' | 'custom'
  status: CustomDomainRow['status']
  primary: boolean
  checkedAt: Date | null
  /** What to add where the domain was bought (SAAS §8 step 2): the pointer to this partner's edge and the ownership token. */
  records: { type: 'CNAME' | 'TXT'; name: string; value: string; found: string | null }[]
}

export interface DomainsView {
  domains: DomainView[]
  /** The plan has `custom_domain` (SAAS §6); on Free, Connect opens the upgrade. */
  customDomainAllowed: boolean
}

export interface StoreDomainsDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  /** The environment's zone, whose `shops.edge.` a domain points at (SAAS §8). */
  edgeZone: string
  /** `*.localhost` names are accepted where the local DNS stand-in answers them (DNS_LOCAL). */
  localHosts: boolean
  /** The domain of every store's free address, `{slug}.<SHOP_DOMAIN>`; null where none is set. */
  shopDomain: string | null
  now: () => Date
}

const pending = (d: CustomDomainRow) => d.status === 'waiting' || d.status === 'verifying' || d.status === 'issuing' || d.status === 'failed'
const live = (d: CustomDomainRow) => d.status === 'live' || d.status === 'expiring'

class Refused extends Error {
  constructor(readonly refusal: DomainRefusal) {
    super(refusal.reason)
  }
}

const viewOf = (d: CustomDomainRow): DomainView => ({
  id: d.id,
  host: d.host,
  kind: 'custom',
  status: d.status,
  primary: d.is_primary && live(d),
  checkedAt: d.checked_at,
  records: [
    { type: 'CNAME', name: d.host, value: d.expected_cname, found: d.found_cname },
    { type: 'TXT', name: `_df-verify.${d.host}`, value: d.ownership_token, found: d.ownership_found },
  ],
})

export const createStoreDomainsService = ({ sql, context, actor, activity, facts, edgeZone, localHosts, shopDomain, now }: StoreDomainsDeps) => {
  const { storeId } = context
  const partnerId = actor.partnerId
  const minute = (at: Date) => Math.floor(at.getTime() / 60_000)

  const entry = (action: string, target: { id: string; label: string }): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId,
    storeId,
    sellerId: null,
    target: { type: 'domain', ...target },
    reason: null,
    api: 'store',
    // Account level (LOGGING §6): the partner reads its stores' domains too.
    visibility: 'partner',
    ...facts,
  })

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<DomainResult<T>> => {
    try {
      return { ok: true, value: await withScope(sql, context, work) }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, ...error.refusal }
      if (uniqueViolation(error, 'custom_domain_host_key')) return { ok: false, reason: 'DOMAIN_TAKEN' }
      throw error
    }
  }

  /** `{slug}.<SHOP_DOMAIN>`, the store's free address. */
  const freeHost = async (): Promise<string | null> => {
    if (!shopDomain) return null
    const slug = await withScope(sql, context, (tx) => selectStoreSlug(tx, storeId))
    return slug ? `${slug}.${shopDomain}` : null
  }

  const domains = async (): Promise<DomainsView> => {
    const [rows, free, limit] = await Promise.all([withScope(sql, context, (tx) => selectStoreDomains(tx, storeId)), freeHost(), planLimitFor(sql, context, { key: 'custom_domain' }, now())])
    const own = rows.map(viewOf)
    const freeView: DomainView[] = free ? [{ id: null, host: free, kind: 'free', status: 'live', primary: !own.some((d) => d.primary), checkedAt: null, records: [] }] : []
    return { domains: [...freeView, ...own], customDomainAllowed: limit === null }
  }

  /** The plan is checked by the caller (`requirePlan`), which answers PLAN_LIMIT with the plan that unlocks it. */
  const connect = (raw: string): Promise<DomainResult<DomainView>> => {
    const typed = parseHostname(raw.trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, ''), { localhost: localHosts })
    if (!typed.ok || typed.wildcard) return Promise.resolve({ ok: false, reason: 'INVALID_HOSTNAME' })
    const host = typed.host
    if (isDripfunnelHost(host, edgeZone) || (shopDomain !== null && (host === shopDomain || host.endsWith(`.${shopDomain}`)))) return Promise.resolve({ ok: false, reason: 'DRIPFUNNEL_DOMAIN' })
    // An apex can't take a CNAME and there is no fixed address to give yet (SAAS §8 "Verify before building: Apex").
    if (isBareDomain(host)) return Promise.resolve({ ok: false, reason: 'APEX_NOT_AVAILABLE', suggested: `www.${host}` })
    return run(async (tx) => {
      await serialise(tx, `custom-domain:${storeId}`)
      const held = await selectStoreDomains(tx, storeId)
      if (held.some((d) => d.host.toLowerCase() === host)) throw new Refused({ reason: 'DOMAIN_TAKEN' })
      if (held.some(pending)) throw new Refused({ reason: 'DOMAIN_PENDING' })
      if (held.length > 0) throw new Refused({ reason: 'DOMAIN_LIMIT' })
      if (await merchantHostTaken(tx, host)) throw new Refused({ reason: 'DOMAIN_TAKEN' })
      const token = `df-verify=${crypto.randomUUID().replaceAll('-', '')}`
      const id = await insertCustomDomain(tx, { storeId, host, status: 'waiting', expectedCname: edgeTargets(edgeZone).shops, ownershipToken: token })
      await queueSideEffect(tx, { kind: 'custom_domain.recheck', idempotencyKey: `${id}:connected`, payload: { storeId, customDomainId: id }, partnerId, storeId })
      await activity.record(tx, entry(domainAudit.connected, { id, label: host }))
      const row = await selectStoreDomainForUpdate(tx, storeId, id)
      if (!row) throw new Error('custom_domain: the connected domain is gone')
      return viewOf(row)
    })
  }

  /** "Check now": a nudge to the deliverer after commit, never a DNS or Cloudflare call from the request (SAAS §8). */
  const check = (id: string): Promise<DomainResult<true>> =>
    run(async (tx) => {
      const domain = await selectStoreDomainForUpdate(tx, storeId, id)
      if (!domain) throw new Refused({ reason: 'NOT_FOUND' })
      if (domain.checked_at !== null && now().getTime() - domain.checked_at.getTime() < 60_000) throw new Refused({ reason: 'TOO_SOON' })
      const queued = await queueSideEffect(tx, { kind: 'custom_domain.recheck', idempotencyKey: `${id}:${minute(now())}`, payload: { storeId, customDomainId: id }, partnerId, storeId })
      if (queued) await activity.record(tx, entry(domainAudit.checkRequested, { id, label: domain.host }))
      return true as const
    })

  const hostOf = (d: CustomDomainRow): MerchantHost => ({ id: d.id, storeId, partnerId, host: d.host })

  /** Null makes the free address primary again. Each change purges the edge's lookup of the store (LIVE-SHOP §5 step 1). */
  const makePrimary = async (id: string | null): Promise<DomainResult<true>> => {
    const free = id === null ? await freeHost() : null
    return run(async (tx) => {
      await serialise(tx, `custom-domain:${storeId}`)
      const held = await selectStoreDomains(tx, storeId)
      const target = id === null ? null : (held.find((d) => d.id === id) ?? null)
      if (id !== null && !target) throw new Refused({ reason: 'NOT_FOUND' })
      if (target && !live(target)) throw new Refused({ reason: 'DOMAIN_NOT_LIVE' })
      const current = held.find((d) => d.is_primary) ?? null
      if ((current?.id ?? null) === (target?.id ?? null)) return true as const
      await setPrimaryDomain(tx, storeId, target?.id ?? null)
      const changed = target ?? current
      if (changed) await queueHostPurge(tx, hostOf(changed), 'primary', now())
      await activity.record(tx, entry(domainAudit.madePrimary, { id: target?.id ?? storeId, label: target?.host ?? free ?? 'free address' }))
      return true as const
    })
  }

  /** Shoppers on it stop reaching the shop; the free address keeps working (PortalStorefront's Remove). */
  const remove = (id: string): Promise<DomainResult<true>> =>
    run(async (tx) => {
      const domain = await selectStoreDomainForUpdate(tx, storeId, id)
      if (!domain) throw new Refused({ reason: 'NOT_FOUND' })
      await deleteStoreDomain(tx, storeId, id)
      await queueMerchantDomainRemoval(tx, hostOf(domain), now())
      await activity.record(tx, entry(domainAudit.removed, { id, label: domain.host }))
      return true as const
    })

  return { domains, connect, check, makePrimary, remove }
}
