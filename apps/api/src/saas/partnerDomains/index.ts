import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import { partnerRoleHas } from '#auth/partnerPermissions'
import { parseHostname } from '#core/hostname'
import { domainKinds, type DomainKind, type HostStatus } from '#db/schema/saas'
import { withScope } from '#db/scoped/index'
import { hostClaimedElsewhere, insertPartnerAddress, selectMerchantDomains, selectPartnerDomainsWithRecords, type PartnerDomainRecordRow } from '#db/scoped/partnerDomains'
import { selectCustomDomains } from '#db/scoped/stores'
import { partnerEntry, type PageInfo } from '#saas/activity/index'
import { ownershipRecord, recordMatches, recordsFor } from '#saas/domains/index'
import { queueSideEffect } from '#saas/outbox/index'
import { decodePage, pageOf, type PageRequest } from '#saas/staff/index'

// Domains on the Platform API (ui/platform/FIRST-RELEASE.md §9; card #197): the partner's four
// addresses, adding one, re-checking one, and its merchants' own domains.

export const domainAudit = {
  addPartnerDomain: 'partner.domain_added',
  recheckPartnerDomain: 'partner.domain_recheck_requested',
  recheckMerchantDomain: 'store.domain_recheck_requested',
} as const

export const merchantDomainPageSize = 25

// Never a partner's own address (FIRST-RELEASE §9.2 "Use a domain your company owns").
const dripfunnelDomains = ['dripfunnel.com', 'dripfunnel.net', 'dripfunnel-mail.com']
// Registrable two-level suffixes, so "northstar.co.uk" reads as bare like "northstar.com".
const twoLevelSuffixes = ['co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'co.nz', 'co.in', 'co.jp', 'com.br', 'com.mx', 'co.za']

const registrableLabels = (host: string): number => (twoLevelSuffixes.includes(host.split('.').slice(-2).join('.')) ? 3 : 2)
const isBare = (host: string): boolean => host.split('.').length <= registrableLabels(host)
const isOurs = (host: string): boolean => dripfunnelDomains.some((d) => host === d || host.endsWith(`.${d}`))
const wildcardKinds: readonly DomainKind[] = ['preview', 'shops']

export type AddRefusal =
  | 'INVALID_INPUT'
  | 'NOT_A_HOSTNAME'
  | 'DRIPFUNNEL_DOMAIN'
  | 'ALREADY_YOURS'
  | 'HOST_TAKEN'
  | 'BARE_DOMAIN_FOR_WILDCARD'
  | 'KIND_TAKEN'
  | 'APEX_NOT_AVAILABLE'

const addInput = z.strictObject({ kind: z.enum(domainKinds), host: z.string().max(260) })

export interface PartnerDomainsDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

const recordDto = (r: PartnerDomainRecordRow) => ({
  purpose: r.purpose,
  type: r.record_type,
  name: r.name,
  value: r.expected,
  found: r.found,
  matches: r.found !== null && recordMatches(r.purpose, r.expected, r.found),
})

export const createPartnerDomainsService = ({ sql, caller, facts, activity, now }: PartnerDomainsDeps) => {
  const partnerId = caller.partner.id
  const context = { caller: { kind: 'partner-user' as const, partnerUserId: caller.user.id }, partnerId }
  const entry = partnerEntry(caller, facts)
  const minute = (at: Date) => Math.floor(at.getTime() / 60_000)

  const partnerDomains = () =>
    withScope(sql, context, async (tx) => {
      const rows = await selectPartnerDomainsWithRecords(tx, partnerId)
      const email = rows.find((r) => r.domain.kind === 'email')?.domain ?? null
      const anyHost = rows.map((r) => r.domain.host.replace(/^\*\./, ''))[0] ?? null
      const label = anyHost ? (anyHost.split('.').at(-registrableLabels(anyHost)) ?? null) : null
      return {
        addresses: domainKinds.map((kind) => {
          const row = rows.find((r) => r.domain.kind === kind)
          if (!row) return { kind, added: false as const }
          const d = row.domain
          return { kind, added: true as const, host: d.host, status: d.status as HostStatus, since: d.created_at, checkedAt: d.checked_at, records: row.records.map(recordDto) }
        }),
        // SAAS §3.6: until the sender is live, mail goes from DripFunnel's domain in the partner's name.
        fallbackSender: email?.status === 'live' || label === null ? null : `no-reply@${label}.dripfunnel-mail.com`,
        add: partnerRoleHas(caller.user.role, 'domains.write') ? { allowed: rows.length < domainKinds.length } : { allowed: false },
      }
    })

  type AddResult = { ok: true; id: string; apex: boolean } | { ok: false; reason: AddRefusal }

  const addPartnerDomain = (raw: unknown): Promise<AddResult> => {
    const parsed = addInput.safeParse(raw)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const { kind } = parsed.data
    const wildcard = wildcardKinds.includes(kind)
    const typed = parseHostname(parsed.data.host.trim().replace(/^\*\./, ''))
    if (!typed.ok || typed.wildcard) return Promise.resolve({ ok: false, reason: 'NOT_A_HOSTNAME' })
    const base = typed.host
    if (isOurs(base)) return Promise.resolve({ ok: false, reason: 'DRIPFUNNEL_DOMAIN' })
    // A wildcard or the email sender on a bare domain would clash with the partner's website.
    if ((wildcard || kind === 'email') && isBare(base)) return Promise.resolve({ ok: false, reason: 'BARE_DOMAIN_FOR_WILDCARD' })
    const host = wildcard ? `*.${base}` : base
    const apex = kind === 'portal' && isBare(base)
    const pointing = recordsFor(kind, host, apex)
    if (!pointing) return Promise.resolve({ ok: false, reason: 'APEX_NOT_AVAILABLE' })
    // The token is the partner's proof of control: another partner's claim on the host never verifies.
    const records = [...pointing, ownershipRecord(host, crypto.randomUUID().replaceAll('-', ''))]
    return withScope(sql, context, async (tx): Promise<AddResult> => {
      const existing = await selectPartnerDomainsWithRecords(tx, partnerId)
      if (existing.some((r) => r.domain.host.toLowerCase() === host)) return { ok: false, reason: 'ALREADY_YOURS' }
      if (existing.some((r) => r.domain.kind === kind)) return { ok: false, reason: 'KIND_TAKEN' }
      if (await hostClaimedElsewhere(tx, host)) return { ok: false, reason: 'HOST_TAKEN' }
      let id: string
      try {
        id = await tx.savepoint((sp) => insertPartnerAddress(sp, { partnerId, kind, host, records }))
      } catch (error) {
        // Two adds of one kind at once: the second meets partner_domain's (partner_id, kind) key.
        if (typeof error === 'object' && error !== null && 'constraint_name' in error && error.constraint_name === 'partner_domain_partner_id_kind_key') return { ok: false, reason: 'KIND_TAKEN' }
        throw error
      }
      await queueSideEffect(tx, { kind: 'domain.recheck', idempotencyKey: `${id}:added`, payload: { partnerId, domainId: id }, partnerId, storeId: null })
      await activity.record(tx, entry({ action: domainAudit.addPartnerDomain, target: { type: 'domain', id, label: host }, reason: null, changes: [{ field: kind, before: null, after: host }] }))
      return { ok: true, id, apex }
    })
  }

  type RecheckResult = { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'INVALID_INPUT' | 'TOO_SOON' }
  // Re-check now is a nudge, not a loop: a minute after the last check, and logged only when queued.
  const recentlyChecked = (checkedAt: Date | null) => checkedAt !== null && now().getTime() - checkedAt.getTime() < 60_000

  const recheckPartnerDomain = (rawKind: unknown): Promise<RecheckResult> => {
    const kind = z.enum(domainKinds).safeParse(rawKind)
    if (!kind.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    return withScope(sql, context, async (tx): Promise<RecheckResult> => {
      const domain = (await selectPartnerDomainsWithRecords(tx, partnerId)).find((r) => r.domain.kind === kind.data)?.domain
      if (!domain) return { ok: false, reason: 'NOT_FOUND' }
      if (recentlyChecked(domain.checked_at)) return { ok: false, reason: 'TOO_SOON' }
      const queued = await queueSideEffect(tx, { kind: 'domain.recheck', idempotencyKey: `${domain.id}:${minute(now())}`, payload: { partnerId, domainId: domain.id }, partnerId, storeId: null })
      if (queued) await activity.record(tx, entry({ action: domainAudit.recheckPartnerDomain, target: { type: 'domain', id: domain.id, label: domain.host }, reason: null }))
      return { ok: true }
    })
  }

  const recheckMerchantDomain = (storeId: string): Promise<RecheckResult> => {
    if (!z.guid().safeParse(storeId).success) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    return withScope(sql, context, async (tx): Promise<RecheckResult> => {
      // RLS shows a partner its own stores' domains only; another partner's store finds none.
      const domain = (await selectCustomDomains(tx, storeId))[0]
      if (!domain) return { ok: false, reason: 'NOT_FOUND' }
      if (recentlyChecked(domain.checked_at)) return { ok: false, reason: 'TOO_SOON' }
      const queued = await queueSideEffect(tx, { kind: 'custom_domain.recheck', idempotencyKey: `${domain.id}:${minute(now())}`, payload: { storeId, customDomainId: domain.id }, partnerId, storeId })
      if (queued) await activity.record(tx, entry({ action: domainAudit.recheckMerchantDomain, storeId, target: { type: 'domain', id: domain.id, label: domain.host }, reason: null }))
      return { ok: true }
    })
  }

  /** Null for a cursor it cannot read. */
  const merchantDomains = (page: PageRequest): Promise<{ items: { storeId: string; storeName: string; host: string; status: HostStatus; since: Date }[]; pageInfo: PageInfo } | null> => {
    const decoded = decodePage(page, merchantDomainPageSize)
    if (!decoded.ok) return Promise.resolve(null)
    return withScope(sql, context, async (tx) => {
      const rows = await selectMerchantDomains(tx, partnerId, decoded, decoded.limit)
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.created_at, id: r.id }))
      return { items: pageRows.map((r) => ({ storeId: r.store_id, storeName: r.store_name, host: r.host, status: r.status, since: r.created_at })), pageInfo }
    })
  }

  return { partnerDomains, addPartnerDomain, recheckPartnerDomain, recheckMerchantDomain, merchantDomains }
}

export type PartnerDomainsService = ReturnType<typeof createPartnerDomainsService>
