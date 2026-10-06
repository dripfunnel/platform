import type postgres from 'postgres'
import { z } from 'zod'
import { withSystemScope } from '#db/scoped/index'
import { selectDomainRecords, selectPartnerDomainForUpdate, updateRecordChecks } from '#db/scoped/partnerDomains'
import { selectPartnerDomainById, updatePartnerDomainCheck } from '#db/scoped/partners'
import { queueSideEffect } from '#saas/outbox/index'
import type { DnsLookup } from '#integrations/dns/doh'
import { activityLog } from '#saas/activity/index'
import { checkRecords } from '#saas/domains/index'
import { CloudflareRefused, hostStatusOf, type CloudflareApi } from '#integrations/cloudflare/api'
import type { Deliverer } from '../outbox-relay'

const payload = z.object({ partnerId: z.guid(), domainId: z.guid() }).strict()

/**
 * `domain.recheck`: the lookup SAAS.md §8 step 3 describes, run after commit with the relay's
 * timeout and retries, never inside the request that asked for it. The result is a row update
 * and a system entry the partner can see.
 */
export const domainRecheckDeliverer = (sql: postgres.Sql, lookup: DnsLookup, now: () => Date = () => new Date(), cloudflare: CloudflareApi | null = null): Deliverer => ({
  deliver: async (effect, signal) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('domain.recheck: bad payload')
    const domain = await withSystemScope(sql, (tx) => selectPartnerDomainById(tx, parsed.data.domainId))
    if (!domain || domain.partner_id !== parsed.data.partnerId) return
    const records = await withSystemScope(sql, (tx) => selectDomainRecords(tx, domain.id))
    const check = await checkRecords(domain.status, records, lookup, signal)
    const at = now()
    // Once DNS points at us, the portal host's state is Cloudflare's: verifying, issuing, live (SAAS §8).
    if (domain.kind === 'portal' && check.status === 'live' && cloudflare) {
      // A removal can commit during the DNS lookup; registering then would orphan the host in Cloudflare.
      const stillThere = await withSystemScope(sql, (tx) => selectPartnerDomainById(tx, domain.id))
      if (!stillThere) return
      try {
        check.status = hostStatusOf(await cloudflare.ensureHostname(domain.host))
      } catch (error) {
        // A refusal (bad host, token) will not change by retrying; an outage throws and the relay retries.
        if (!(error instanceof CloudflareRefused)) throw error
        check.status = 'failed'
      }
    }
    await withSystemScope(sql, async (tx) => {
      // Locked, so two checks at once agree on what changed: one entry and one email per change.
      const current = await selectPartnerDomainForUpdate(tx, domain.id)
      if (!current) return
      let status = check.status
      try {
        await tx.savepoint((sp) => updatePartnerDomainCheck(sp, domain.id, { status, found: check.found, checkedAt: at }))
      } catch (error) {
        // Another partner proved this host first (0020's partner_domain_host_key): this claim fails.
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')) throw error
        status = 'failed'
        await updatePartnerDomainCheck(tx, domain.id, { status, found: check.found, checkedAt: at })
      }
      await updateRecordChecks(tx, check.records, at)
      // FIRST-RELEASE §9.2: "We check every 10 minutes and email you when it's live."
      if (status === 'live' && current.status !== 'live') {
        await queueSideEffect(tx, {
          kind: 'email',
          idempotencyKey: `partner-domain-live:${domain.id}:${current.checked_at?.toISOString() ?? 'never'}`,
          payload: { template: 'partner-domain-live', partnerId: domain.partner_id, domainId: domain.id, kind: domain.kind },
          partnerId: domain.partner_id,
          storeId: null,
        })
      }
      if (status !== current.status) {
        await activityLog.record(tx, {
          category: 'system',
          action: 'partner.domain_status_changed',
          result: 'success',
          actorKind: 'job',
          actorId: 'domain.recheck',
          actorLabel: 'Domain check',
          partnerId: domain.partner_id,
          target: { type: 'domain', id: domain.id, label: domain.host },
          changes: [{ field: 'status', before: current.status, after: status }],
          reason: null,
          api: 'system',
          requestId: null,
          ip: null,
          userAgent: null,
          visibility: 'partner',
        })
      }
    })
  },
})
