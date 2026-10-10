import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import type { StoreCaller } from '#auth/storeCaller'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import { insertOutboxMany } from '#db/scoped/outbox'
import { isStoreEvent } from '#db/scoped/storeEvents'
import {
  countEndpoints,
  insertDelivery,
  insertEndpoint,
  lockEndpoint,
  markEndpointWorking,
  releaseHeld,
  removeEndpoint,
  selectDeliveries,
  selectEndpoints,
  selectStoredDelivery,
  updateEndpoint,
} from '#db/scoped/webhooks'
import type { DnsLookup } from '#integrations/dns/doh'
import { checkedUrl } from '#integrations/http/publicFetch'
import { queueSideEffect } from '#saas/outbox/index'

// Settings › Developers' webhooks (PLATFORM-PROMPT §5.5, ACCESS §5.6, SetDev): the Owner's (`settings`). An endpoint's
// address is checked when saved, when replayed and on every delivery; its signing secret is shown once.

export const webhookAudit = {
  saved: 'webhook.saved',
  removed: 'webhook.removed',
  turnedOn: 'webhook.turned_on',
  replayed: 'webhook.delivery_replayed',
} as const

export const webhookDeliveryKind = 'webhook.deliver'

/** Endpoints a store may have at once. */
export const maxEndpoints = 10
/** ACCESS §5.6: failing this long turns an endpoint off, and what it misses waits this long to be sent again. */
export const failingForMs = 3 * 24 * 60 * 60 * 1000
export const replayWindowMs = 7 * 24 * 60 * 60 * 1000

export type WebhookRefusal = 'INVALID_INPUT' | 'BAD_URL' | 'PRIVATE_ADDRESS' | 'NOT_FOUND' | 'TOO_MANY_ENDPOINTS' | 'UNAVAILABLE' | 'ENDPOINT_OFF' | 'TOO_OLD'
export type WebhookResult<T> = { ok: true; value: T } | { ok: false; reason: WebhookRefusal }

const secretAlphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const newSigningSecret = (): string => {
  let out = 'whsec_'
  while (out.length < 6 + 32) {
    for (const byte of crypto.getRandomValues(new Uint8Array(64))) if (byte < 248 && out.length < 6 + 32) out += secretAlphabet[byte % 62]
  }
  return out
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** `t=<unix seconds>,v1=<HMAC-SHA256 of "t.body">`, which the receiver recomputes with its secret (docs/api/ACCESS.md §5.6). */
export const signWebhook = async (secret: string, body: string, at: Date): Promise<string> => {
  const t = Math.floor(at.getTime() / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return `t=${t},v1=${hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))}`
}

/** A public https address now, or why not: the same check every delivery makes again. */
export const checkEndpointUrl = async (raw: string, lookup: DnsLookup | null): Promise<{ ok: true; url: string } | { ok: false; reason: 'BAD_URL' | 'PRIVATE_ADDRESS' | 'UNAVAILABLE' }> => {
  const url = raw.trim()
  if (url.length > 2000 || !url.startsWith('https://')) return { ok: false, reason: 'BAD_URL' }
  if (!lookup) return { ok: false, reason: 'UNAVAILABLE' }
  try {
    const checked = await checkedUrl(url, lookup, AbortSignal.timeout(5_000))
    if (checked === 'PRIVATE_ADDRESS') return { ok: false, reason: 'PRIVATE_ADDRESS' }
    if (typeof checked === 'string') return { ok: false, reason: checked === 'BAD_URL' || checked === 'NOT_FOUND' ? 'BAD_URL' : 'UNAVAILABLE' }
    return { ok: true, url: checked.toString() }
  } catch {
    return { ok: false, reason: 'UNAVAILABLE' }
  }
}

export interface WebhooksDeps {
  sql: postgres.Sql
  caller: StoreCaller
  activity: ActivityLog
  facts: RequestFacts
  secrets: SecretBox | null
  lookup: DnsLookup | null
  now: () => Date
}

export const createWebhooksService = ({ sql, caller, activity, facts, secrets, lookup, now }: WebhooksDeps) => {
  const storeId = caller.store.id
  const inStore = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, caller.context, work)

  const entry = (action: string, endpoint: { id: string; url: string }, changes: ActivityEntry['changes'] = [], reason: string | null = null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: caller.person.id,
    actorLabel: null,
    partnerId: caller.person.partnerId,
    storeId,
    target: { type: 'webhook_endpoint', id: endpoint.id, label: new URL(endpoint.url).host },
    changes,
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const deliveryEffect = (deliveryId: string, key: string) =>
    ({ kind: webhookDeliveryKind, idempotencyKey: key, payload: { deliveryId }, partnerId: caller.context.partnerId, storeId })

  const list = (window: PageWindow) => inStore((tx) => selectEndpoints(tx, storeId, window))

  const deliveries = async (rawEndpointId: string, window: PageWindow) => {
    const endpointId = rawEndpointId.toLowerCase()
    if (!isUuid(endpointId)) return []
    return inStore((tx) => selectDeliveries(tx, storeId, endpointId, window))
  }

  /** A new endpoint answers its signing secret, once; saving an existing one keeps its secret. */
  const save = async (rawId: string | null, rawUrl: string, rawEvents: readonly string[]): Promise<WebhookResult<{ id: string; secret: string | null }>> => {
    const events = [...new Set(rawEvents)].sort()
    if (events.length === 0 || !events.every(isStoreEvent)) return { ok: false, reason: 'INVALID_INPUT' }
    const id = rawId?.toLowerCase() ?? null
    if (id !== null && !isUuid(id)) return { ok: false, reason: 'NOT_FOUND' }
    const checked = await checkEndpointUrl(rawUrl, lookup)
    if (!checked.ok) return { ok: false, reason: checked.reason }
    const url = checked.url
    const at = now()
    if (id === null) {
      if (!secrets) return { ok: false, reason: 'UNAVAILABLE' }
      const secret = newSigningSecret()
      const sealed = await secrets.seal(secret)
      const newId = crypto.randomUUID()
      return inStore(async (tx) => {
        await serialise(tx, `webhooks:${storeId}`)
        if ((await countEndpoints(tx, storeId)) >= maxEndpoints) return { ok: false, reason: 'TOO_MANY_ENDPOINTS' } as const
        await insertEndpoint(tx, { id: newId, storeId, url, events, secretSealed: sealed, by: caller.person.id, now: at })
        await activity.record(tx, entry(webhookAudit.saved, { id: newId, url }, [{ field: 'events', before: null, after: events.join(', ') }]))
        return { ok: true, value: { id: newId, secret } } as const
      })
    }
    return inStore(async (tx) => {
      const old = await lockEndpoint(tx, storeId, id)
      if (!old) return { ok: false, reason: 'NOT_FOUND' } as const
      await updateEndpoint(tx, id, url, events, at)
      await activity.record(tx, entry(webhookAudit.saved, { id, url }, [
        { field: 'url', before: new URL(old.url).host, after: new URL(url).host },
        { field: 'events', before: old.events.join(', '), after: events.join(', ') },
      ]))
      return { ok: true, value: { id, secret: null } } as const
    })
  }

  const remove = async (rawId: string): Promise<WebhookResult<true>> => {
    const id = rawId.toLowerCase()
    if (!isUuid(id)) return { ok: false, reason: 'NOT_FOUND' }
    return inStore(async (tx) => {
      const old = await lockEndpoint(tx, storeId, id)
      if (!old) return { ok: false, reason: 'NOT_FOUND' } as const
      await removeEndpoint(tx, id, now())
      await activity.record(tx, entry(webhookAudit.removed, old))
      return { ok: true, value: true } as const
    })
  }

  /** "Turn back on": what waited for it in the last week is sent now (SetDev). */
  const turnOn = async (rawId: string): Promise<WebhookResult<number>> => {
    const id = rawId.toLowerCase()
    if (!isUuid(id)) return { ok: false, reason: 'NOT_FOUND' }
    const checked = await inStore((tx) => lockEndpoint(tx, storeId, id))
    if (!checked) return { ok: false, reason: 'NOT_FOUND' }
    const url = await checkEndpointUrl(checked.url, lookup)
    if (!url.ok) return { ok: false, reason: url.reason }
    const at = now()
    return inStore(async (tx) => {
      const old = await lockEndpoint(tx, storeId, id)
      if (!old) return { ok: false, reason: 'NOT_FOUND' } as const
      await markEndpointWorking(tx, id, at)
      const released = await releaseHeld(tx, id, new Date(at.getTime() - replayWindowMs))
      await insertOutboxMany(tx, released.map((deliveryId) => deliveryEffect(deliveryId, `${deliveryId}:on:${at.getTime()}`)))
      await activity.record(tx, entry(webhookAudit.turnedOn, old, [], old.status))
      return { ok: true, value: released.length } as const
    })
  }

  /** "Send again": a new delivery of the same event, to an endpoint that is on, within the week. */
  const replay = async (rawId: string): Promise<WebhookResult<string>> => {
    const id = rawId.toLowerCase()
    if (!isUuid(id)) return { ok: false, reason: 'NOT_FOUND' }
    const found = await inStore(async (tx) => {
      const d = await selectStoredDelivery(tx, storeId, id)
      return d ? { d, endpoint: await lockEndpoint(tx, storeId, d.endpoint_id) } : null
    })
    if (!found?.endpoint) return { ok: false, reason: 'NOT_FOUND' }
    const at = now()
    if (found.d.created_at.getTime() < at.getTime() - replayWindowMs) return { ok: false, reason: 'TOO_OLD' }
    if (found.endpoint.status === 'disabled') return { ok: false, reason: 'ENDPOINT_OFF' }
    const url = await checkEndpointUrl(found.endpoint.url, lookup)
    if (!url.ok) return { ok: false, reason: url.reason }
    const newId = crypto.randomUUID()
    return inStore(async (tx) => {
      const endpoint = await lockEndpoint(tx, storeId, found.d.endpoint_id)
      if (!endpoint) return { ok: false, reason: 'NOT_FOUND' } as const
      if (endpoint.status === 'disabled') return { ok: false, reason: 'ENDPOINT_OFF' } as const
      await insertDelivery(tx, { id: newId, endpointId: endpoint.id, storeId, event: found.d.event, eventId: found.d.event_id, body: found.d.body, status: 'pending', replayOf: found.d.id, now: at })
      await queueSideEffect(tx, deliveryEffect(newId, newId))
      await activity.record(tx, entry(webhookAudit.replayed, endpoint, [], found.d.event))
      return { ok: true, value: newId } as const
    })
  }

  return { list, deliveries, save, remove, turnOn, replay }
}
