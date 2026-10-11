import type postgres from 'postgres'
import { z } from 'zod'
import { logEvent } from '#core/log'
import { withSystemScope } from '#db/scoped/index'
import { hostHeld, selectStoreShops } from '#db/scoped/partnerDomains'
import { selectPartnerDomainById } from '#db/scoped/partners'
import type { CloudflareApi } from '#integrations/cloudflare/api'
import { activityLog } from '#saas/activity/index'
import { registerHostname, registerStoreHostsPage, removeStoreHostsPage, shopsHostOf } from '#saas/domains/index'
import type { Deliverer } from '../outbox-relay'

const syncPayload = z.object({ partnerId: z.guid(), storeId: z.guid() }).strict()
const pagePayload = z.object({ partnerId: z.guid(), domainId: z.guid(), after: z.string().min(1).nullable() }).strict()
const registerPayload = pagePayload.extend({ round: z.string().min(1) }).strict()
const removalPayload = pagePayload.extend({ host: z.string().startsWith('*.') }).strict()

export const storeHostRefusedAction = 'store.shops_host_refused'

/**
 * `store_host.sync`: registers the store's shops host with Cloudflare for SaaS while its partner's shops
 * address is live, and takes it out once the store is closed (SAAS §5 step 3). Until the address is live it does nothing.
 */
export const storeHostSyncDeliverer = (sql: postgres.Sql, cloudflare: CloudflareApi): Deliverer => ({
  deliver: async (effect) => {
    const parsed = syncPayload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('store_host.sync: bad payload')
    const { partnerId, storeId } = parsed.data
    const read = () => withSystemScope(sql, (tx) => selectStoreShops(tx, storeId))
    const store = await read()
    // The address is joined through the store's own partner, so no store takes another partner's.
    if (!store || store.partner_id !== partnerId || !store.shops_id || !store.shops_host) return
    const host = shopsHostOf(store.shops_host, store.code)
    if (store.status === 'closed') {
      if (!(await withSystemScope(sql, (tx) => hostHeld(tx, host)))) await cloudflare.removeHostname(host)
      return
    }
    if (store.shops_status !== 'live') return
    const wanted = async () => {
      const now = await read()
      return now !== null && now.status !== 'closed' && now.shops_id === store.shops_id
    }
    if ((await registerHostname(cloudflare, host, wanted)) !== 'failed') return
    // Recorded in both logs and kept nowhere else (decided on #519); retrying would not change Cloudflare's answer.
    logEvent({ event: 'store_host.refused', api: 'system', partnerId, storeId, code: 'cloudflare_refused' })
    await withSystemScope(sql, (tx) =>
      activityLog.record(tx, {
        category: 'system',
        action: storeHostRefusedAction,
        result: 'failed',
        actorKind: 'job',
        actorId: 'store_host.sync',
        actorLabel: 'Shop address',
        partnerId,
        storeId,
        target: { type: 'domain', id: storeId, label: host },
        reason: null,
        api: 'system',
        requestId: null,
        ip: null,
        userAgent: null,
        // Account-level (LOGGING.md §6), as a domain's status change is.
        visibility: 'partner',
      }),
    )
  },
})

/** `store_hosts.register`: a page of the partner's stores once its shops address is live (SAAS §8). */
export const storeHostsRegisterDeliverer = (sql: postgres.Sql): Deliverer => ({
  deliver: async (effect) => {
    const parsed = registerPayload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('store_hosts.register: bad payload')
    const { partnerId, domainId, round, after } = parsed.data
    await withSystemScope(sql, async (tx) => {
      const address = await selectPartnerDomainById(tx, domainId)
      if (!address || address.partner_id !== partnerId || address.kind !== 'shops' || address.status !== 'live') return
      await registerStoreHostsPage(tx, { partnerId, domainId, round }, after)
    })
  },
})

/** `store_hosts.remove`: a page of the partner's stores after its shops address was removed, each host through `domain.remove`. */
export const storeHostsRemoveDeliverer = (sql: postgres.Sql): Deliverer => ({
  deliver: async (effect) => {
    const parsed = removalPayload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('store_hosts.remove: bad payload')
    const { partnerId, domainId, host, after } = parsed.data
    await withSystemScope(sql, (tx) => removeStoreHostsPage(tx, { partnerId, domainId, host }, after))
  },
})
