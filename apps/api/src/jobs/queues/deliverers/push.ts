import { selectOfferDistance } from '#db/scoped/dispatch'
import type postgres from 'postgres'
import { failureCode, logEvent } from '#core/log'
import { emitMeasurements, type Measurement } from '#core/metrics'
import { withSystemScope } from '#db/scoped/index'
import { deleteDevicesByIds, selectPushStore, selectSubjectDevices } from '#db/scoped/pushDevices'
import { ExpoPushRefused, notRegistered, type ExpoPush } from '#integrations/expoPush/index'
import { NotYet } from '#saas/outbox/index'
import { composePush, pushPayloadSchema, pushReceiptsPayloadSchema, queuePushReceipts, receiptsAfterMs, receiptsKeptMs } from '#saas/push/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

// `push` and `push.receipts` (DELIVERY §6; decided on #840). One row is one subject's phones in one store, so one Expo
// project; a retry after a partial send can push twice, as Expo's own delivery is at least once.

/** One measurement per send Expo refused, by its error code (DELIVERY §3): at the ticket, or later at the receipt. */
const failedSends = (storeId: string, codes: readonly (string | null | undefined)[]): Measurement[] =>
  codes.flatMap((code) => (code ? [{ storeId, metric: 'push_send_failed' as const, value: 1, code }] : []))

const dropper = (effect: { partnerId: string | null; storeId: string | null }) => {
  const log = (event: string, code: string) => logEvent({ event, api: 'system', partnerId: effect.partnerId, storeId: effect.storeId, code })
  const drop = (event: string, code: string): never => {
    log(event, code)
    throw new GiveUp(code)
  }
  return { log, drop }
}

export const pushDeliverer = (sql: postgres.Sql, sender: ExpoPush, now: () => Date = () => new Date()): Deliverer => ({
  redact: (payload) => {
    const message = (payload as { message?: unknown } | null)?.message
    return { message: typeof message === 'string' ? message : null, redacted: true }
  },
  deliver: async (effect, signal) => {
    const { log, drop } = dropper(effect)
    const parsed = pushPayloadSchema.safeParse(effect.payload)
    if (!parsed.success || !effect.partnerId || !effect.storeId) return drop('push_skipped', 'bad_payload')
    const payload = parsed.data
    const partnerId = effect.partnerId
    const storeId = effect.storeId
    const found = await withSystemScope(sql, async (tx) => {
      const store = await selectPushStore(tx, storeId)
      if (store?.partner_id !== partnerId) return null
      const distance = payload.deliveryId && payload.message === 'rider.offer' ? await selectOfferDistance(tx, storeId, payload.deliveryId, payload.subject.id) : null
      return { store, distance, devices: await selectSubjectDevices(tx, storeId, payload.subject.kind, payload.subject.id) }
    })
    if (!found) return drop('push_skipped', 'no_store')
    // Signed out, suspended or deleted since: nobody to tell.
    if (found.devices.length === 0) return log('push_skipped', 'no_devices')
    const words = composePush(payload, found.store, found.distance)
    const subject = `${payload.subject.kind}:${payload.subject.id}`
    let tickets
    try {
      tickets = await sender.send(found.devices.map((d) => ({ to: d.expo_token, subject, ...words })), signal)
    } catch (error) {
      if (error instanceof ExpoPushRefused) return drop('push_refused', error.code)
      log('push_failed', failureCode(error))
      throw error
    }
    const dead = found.devices.filter((_, i) => tickets[i]?.error === notRegistered).map((d) => d.id)
    const sent = found.devices.flatMap((d, i) => {
      const ticketId = tickets[i]?.id
      return ticketId ? [{ ticketId, deviceId: d.id }] : []
    })
    await withSystemScope(sql, async (tx) => {
      await deleteDevicesByIds(tx, storeId, dead)
      if (sent.length > 0) await queuePushReceipts(tx, { partnerId, storeId, idempotencyKey: `${effect.id}:${effect.attempt}`, payload: { tickets: sent, sentAt: now().toISOString() } })
    })
    // After the rows are kept: a retry of this push, after a failure above, would count the same refused sends twice.
    emitMeasurements(failedSends(storeId, tickets.map((t) => t.error)))
    log('push_sent', dead.length > 0 ? 'some_unregistered' : 'sent')
  },
})

export const pushReceiptsDeliverer = (sql: postgres.Sql, sender: ExpoPush, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect, signal) => {
    const { log, drop } = dropper(effect)
    const parsed = pushReceiptsPayloadSchema.safeParse(effect.payload)
    if (!parsed.success || !effect.storeId) return drop('push_receipts_skipped', 'bad_payload')
    const { tickets, sentAt } = parsed.data
    const storeId = effect.storeId
    let receipts
    try {
      receipts = await sender.receipts(tickets.map((t) => t.ticketId), signal)
    } catch (error) {
      if (error instanceof ExpoPushRefused) return drop('push_receipts_refused', error.code)
      log('push_receipts_failed', failureCode(error))
      throw error
    }
    const dead = tickets.filter((t) => receipts.get(t.ticketId) === notRegistered).map((t) => t.deviceId)
    if (dead.length > 0) await withSystemScope(sql, (tx) => deleteDevicesByIds(tx, storeId, dead))
    for (const code of new Set([...receipts.values()])) if (code && code !== notRegistered) log('push_receipt_error', code)
    // Receipts Expo hasn't made yet are asked again until it clears them, a day after the send.
    const pending = tickets.some((t) => !receipts.has(t.ticketId))
    if (pending && now().getTime() - new Date(sentAt).getTime() < receiptsKeptMs) throw new NotYet('receipts_pending', receiptsAfterMs)
    // Only the last pass counts them: an earlier one is asked again, and would count the same failures twice.
    emitMeasurements(failedSends(storeId, tickets.map((t) => receipts.get(t.ticketId) ?? null)))
    log('push_receipts_read', dead.length > 0 ? 'some_unregistered' : pending ? 'some_unanswered' : 'read')
  },
})
