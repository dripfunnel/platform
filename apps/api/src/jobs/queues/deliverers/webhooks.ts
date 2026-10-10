import type postgres from 'postgres'
import { z } from 'zod'
import type { SecretBox } from '#auth/secretBox'
import { withSystemScope } from '#db/scoped/index'
import { storeEvents } from '#db/scoped/storeEvents'
import { disableEndpoint, failDelivery, holdDelivery, insertDelivery, markEndpointFailing, markEndpointWorking, recordDeliveryAttempt, selectDeliveryToSend, selectEndpointsFor } from '#db/scoped/webhooks'
import type { DnsLookup } from '#integrations/dns/doh'
import { postPublic } from '#integrations/http/publicPost'
import { queueSideEffect } from '#saas/outbox/index'
import { failingForMs, signWebhook, webhookDeliveryKind } from '#saas/webhooks/index'
import { defaultRelayOptions, GiveUp, type Deliverer } from '../outbox-relay'

// Webhooks from the outbox (PLATFORM-PROMPT §5.5): `webhook.event` makes one delivery per endpoint that takes the event,
// and `webhook.deliver` sends one, signed, with a timeout, retried by the relay's backoff up to its limit.

const event = z.object({
  eventId: z.uuid(),
  event: z.enum(storeEvents),
  data: z.object({ object: z.enum(['order', 'product', 'product_version']), id: z.uuid(), number: z.string().max(40).optional() }).strict(),
  occurredAt: z.iso.datetime(),
}).strict()

/** The body every endpoint of the event gets, ids only (decided on #330). */
const bodyOf = (e: z.infer<typeof event>, storeId: string) => JSON.stringify({ id: e.eventId, type: e.event, createdAt: e.occurredAt, store: storeId, data: e.data })

export const webhookEventDeliverer = (sql: postgres.Sql, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = event.safeParse(effect.payload)
    if (!parsed.success || !effect.storeId || !effect.partnerId) throw new GiveUp('bad_payload')
    const e = parsed.data
    const storeId = effect.storeId
    const partnerId = effect.partnerId
    await withSystemScope(sql, async (tx) => {
      for (const endpoint of await selectEndpointsFor(tx, storeId, e.event)) {
        const id = crypto.randomUUID()
        // A turned-off endpoint's events wait for "Turn back on" (ACCESS §5.6's week).
        const status = endpoint.status === 'disabled' ? 'held' : 'pending'
        const made = await insertDelivery(tx, { id, endpointId: endpoint.id, storeId, event: e.event, eventId: e.eventId, body: bodyOf(e, storeId), status, replayOf: null, now: now() })
        if (made && status === 'pending') await queueSideEffect(tx, { kind: webhookDeliveryKind, idempotencyKey: id, payload: { deliveryId: id }, partnerId, storeId })
      }
    })
  },
})

const delivery = z.object({ deliveryId: z.uuid() }).strict()

/** Each attempt waits at most this long for the endpoint's answer, inside the relay's own timeout. */
export const webhookTimeoutMs = 5_000

export interface WebhookSendDeps {
  lookup: DnsLookup
  secrets: SecretBox | null
  fetchImpl?: typeof fetch
  now?: () => Date
}

export const webhookDeliveryDeliverer = (sql: postgres.Sql, deps: WebhookSendDeps): Deliverer => ({
  deliver: async (effect) => {
    const parsed = delivery.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    const now = deps.now ?? (() => new Date())
    const d = await withSystemScope(sql, (tx) => selectDeliveryToSend(tx, parsed.data.deliveryId))
    if (!d || d.status !== 'pending' || d.store_id !== effect.storeId) return
    if (d.endpoint_gone) {
      await withSystemScope(sql, (tx) => failDelivery(tx, d.id, 'endpoint_removed'))
      return
    }
    if (d.endpoint_status === 'disabled') {
      await withSystemScope(sql, (tx) => holdDelivery(tx, d.id, null))
      return
    }
    const secret = deps.secrets ? await deps.secrets.open(d.secret_sealed) : null
    if (!secret) throw new GiveUp('no_signing_key')
    const at = now()
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'DripFunnel-Webhooks/1',
      'dripfunnel-event': d.event,
      'dripfunnel-delivery': d.id,
      'dripfunnel-signature': await signWebhook(secret, d.body, at),
    }
    const sent = await postPublic(d.url, d.body, headers, { lookup: deps.lookup, timeoutMs: webhookTimeoutMs, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) })
    const worked = sent.ok && sent.status >= 200 && sent.status < 300
    const responseCode = sent.ok ? sent.status : null
    const error = worked ? null : sent.ok ? 'status' : sent.code.toLowerCase()
    const last = effect.attempt >= defaultRelayOptions.maxAttempts
    const outcome = await withSystemScope(sql, async (tx) => {
      if (worked) {
        await recordDeliveryAttempt(tx, d.id, { status: 'delivered', responseCode, error: null, durationMs: sent.ms, now: at })
        await markEndpointWorking(tx, d.endpoint_id, at)
        return 'delivered'
      }
      const since = await markEndpointFailing(tx, d.endpoint_id, at)
      if (at.getTime() - since.getTime() >= failingForMs) {
        await recordDeliveryAttempt(tx, d.id, { status: 'held', responseCode, error, durationMs: sent.ms, now: at })
        if (await disableEndpoint(tx, d.endpoint_id, at)) {
          await queueSideEffect(tx, { kind: 'email', idempotencyKey: `webhook-off:${d.endpoint_id}:${at.getTime()}`, payload: { template: 'webhook-disabled', storeId: d.store_id, host: new URL(d.url).host }, partnerId: effect.partnerId, storeId: d.store_id })
        }
        return 'held'
      }
      await recordDeliveryAttempt(tx, d.id, { status: last ? 'failed' : 'pending', responseCode, error, durationMs: sent.ms, now: at })
      return 'retry'
    })
    // The relay backs off and tries again, up to its limit; a code, never the endpoint's words (outbox-relay.ts).
    if (outcome === 'retry') throw new Error(error ?? 'failed')
  },
})
