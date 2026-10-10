import type postgres from 'postgres'
import { z } from 'zod'
import type { SecretBox } from '#auth/secretBox'
import { selectAppNotice } from '#db/scoped/apps'
import { withSystemScope } from '#db/scoped/index'
import { selectLivePortalHost } from '#db/scoped/partners'
import type { DnsLookup } from '#integrations/dns/doh'
import { postPublic } from '#integrations/http/publicPost'
import { NotYet } from '#saas/outbox/index'
import { signWebhook } from '#saas/webhooks/index'
import { GiveUp, type Deliverer } from '../outbox-relay'
import { webhookTimeoutMs } from './webhooks'

// `app.notice` (#330): an app hears of its install, with the grant's token, and of its uninstall, at its own address,
// signed with its secret like a webhook. The token rests in the row sealed and leaves the row once it's sent.

const notice = z.discriminatedUnion('notice', [
  z.object({ grantId: z.uuid(), notice: z.literal('installed'), tokenSealed: z.string().max(400) }).strict(),
  z.object({ grantId: z.uuid(), notice: z.literal('uninstalled') }).strict(),
])

export interface AppNoticeDeps {
  lookup: DnsLookup
  secrets: SecretBox | null
  fetchImpl?: typeof fetch
  now?: () => Date
}

export const appNoticeDeliverer = (sql: postgres.Sql, deps: AppNoticeDeps): Deliverer => ({
  deliver: async (effect) => {
    const parsed = notice.safeParse(effect.payload)
    if (!parsed.success || !effect.storeId) throw new GiveUp('bad_payload')
    const n = parsed.data
    const found = await withSystemScope(sql, async (tx) => {
      const app = await selectAppNotice(tx, n.grantId)
      return app ? { app, host: await selectLivePortalHost(tx, app.partner_id) } : null
    })
    if (!found || found.app.partner_id !== effect.partnerId) throw new GiveUp('no_grant')
    if (found.app.status !== 'live') throw new GiveUp('app_suspended')
    if (!found.host) throw new NotYet('no_portal_host', 60 * 60 * 1000)
    const secret = deps.secrets ? await deps.secrets.open(found.app.secret_sealed) : null
    const token = n.notice === 'installed' && deps.secrets ? await deps.secrets.open(n.tokenSealed) : null
    if (!secret || (n.notice === 'installed' && !token)) throw new GiveUp('no_signing_key')
    const at = (deps.now ?? (() => new Date()))()
    const body = JSON.stringify({
      type: `app.${n.notice}`,
      createdAt: at.toISOString(),
      grant: n.grantId,
      store: { id: effect.storeId, name: found.app.store_name },
      ...(token ? { token, api: `https://${found.host}/api` } : {}),
    })
    const headers = { 'content-type': 'application/json', 'user-agent': 'DripFunnel-Webhooks/1', 'dripfunnel-event': `app.${n.notice}`, 'dripfunnel-delivery': effect.id, 'dripfunnel-signature': await signWebhook(secret, body, at) }
    const sent = await postPublic(found.app.webhook_url, body, headers, { lookup: deps.lookup, timeoutMs: webhookTimeoutMs, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) })
    if (!sent.ok) throw new Error(sent.code.toLowerCase())
    if (sent.status < 200 || sent.status >= 300) throw new Error('status')
  },
  // The sealed token goes with the delivery, whatever its outcome.
  redact: (payload) => {
    const parsed = notice.safeParse(payload)
    return parsed.success ? { grantId: parsed.data.grantId, notice: parsed.data.notice } : {}
  },
})
