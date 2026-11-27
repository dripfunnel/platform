import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import type { SecretBox } from '#auth/secretBox'
import { PaymentRefused, PaymentUnavailable } from '#core/payments'
import { serialise, withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { deleteBillingGateway, forgetRazorpaySubscriptions, insertBillingGateway, selectAnyRazorpaySubscription, selectBillingGateway, selectBillingGateways, updateBillingGateway, type GatewayMode } from '#db/scoped/razorpayBilling'
import { keyHintOf, razorpayKeysSchema, type RazorpayBilling } from '#integrations/payments/index'
import { partnerEntry } from '#saas/activity/index'

// Billing › Razorpay account (#1744; SAAS §7.4, THIRD-PARTY-ACCESS §3.1): the partner's own keys its merchants pay their
// plan with, live and test. Checked with Razorpay before they are sealed; shown back as "rzp_live_••••AbCd", never more.

export const razorpayAudit = {
  connected: 'partner.razorpay_connected',
  disconnected: 'partner.razorpay_disconnected',
} as const

export type GatewayRefusal = 'INVALID_INPUT' | 'KEY_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_FOUND'
export type GatewayResult = { ok: true } | { ok: false; reason: GatewayRefusal }

const modeInput = z.enum(['live', 'test'])

export interface PartnerRazorpayDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  api: RazorpayBilling
  /** The hooks host the partner's webhook address is on, e.g. hooks.dripfunnel.ai. */
  hooksHost: string
  now: () => Date
}

export const createPartnerRazorpayService = ({ sql, caller, facts, activity, secrets, api, hooksHost, now }: PartnerRazorpayDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)
  const entry = partnerEntry(caller, facts)
  const target = { type: 'billing_gateway', id: partnerId, label: 'Razorpay' }
  const lock = (tx: ScopedSql) => serialise(tx, `partner_razorpay:${partnerId}`)

  const account = () =>
    withScope(sql, context, async (tx) => {
      const rows = await selectBillingGateways(tx, partnerId)
      return {
        webhookUrl: `https://${hooksHost}/razorpay/partner/${partnerId}`,
        modes: (['live', 'test'] as const).map((mode) => {
          const row = rows.find((r) => r.mode === mode)
          return { mode, connected: !!row, keyHint: row?.key_prefix ?? null, checkedAt: row?.last_tested_at ?? null }
        }),
      }
    })

  const connect = async (rawMode: unknown, rawKeys: unknown): Promise<GatewayResult> => {
    const mode = modeInput.safeParse(rawMode)
    const keys = razorpayKeysSchema.safeParse(rawKeys)
    if (!mode.success || !keys.success || !keys.data.keyId.startsWith(`rzp_${mode.data}_`)) return { ok: false, reason: 'INVALID_INPUT' }
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    try {
      await api.verify(keys.data)
    } catch (error) {
      if (error instanceof PaymentUnavailable) return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
      if (error instanceof PaymentRefused) return { ok: false, reason: 'KEY_REJECTED' }
      throw error
    }
    // Another account's keys can't read the stores' subscriptions: they stay on the old account and subscribe again.
    const known = await withSystemScope(sql, (tx) => selectAnyRazorpaySubscription(tx, partnerId, mode.data))
    let otherAccount = false
    if (known) {
      try {
        await api.subscription(keys.data, known)
      } catch (error) {
        if (error instanceof PaymentUnavailable) return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
        if (!(error instanceof PaymentRefused)) throw error
        otherAccount = true
      }
    }
    const at = now()
    const write = { keyEnc: await secrets.seal(JSON.stringify(keys.data)), keyPrefix: keyHintOf(keys.data.keyId), at }
    await withScope(sql, context, async (tx) => {
      await lock(tx)
      const before = await selectBillingGateway(tx, partnerId, mode.data)
      if (before) await updateBillingGateway(tx, before.id, write)
      else await insertBillingGateway(tx, { ...write, partnerId, mode: mode.data, createdBy: actingName(caller) })
      await activity.record(tx, entry({ action: razorpayAudit.connected, target, reason: mode.data, changes: [{ field: 'key', before: before?.key_prefix ?? null, after: write.keyPrefix }] }))
    })
    if (otherAccount) await withSystemScope(sql, (tx) => forgetRazorpaySubscriptions(tx, partnerId, mode.data))
    return { ok: true }
  }

  /** The keys are deleted and the stores forget their subscriptions, which the partner ends in Razorpay (SAAS §7.4). */
  const disconnect = async (rawMode: unknown): Promise<GatewayResult> => {
    const mode = modeInput.safeParse(rawMode)
    if (!mode.success) return { ok: false, reason: 'INVALID_INPUT' }
    const removed = await withScope(sql, context, async (tx) => {
      await lock(tx)
      const row = await selectBillingGateway(tx, partnerId, mode.data)
      if (!row) return false
      await deleteBillingGateway(tx, row.id)
      await activity.record(tx, entry({ action: razorpayAudit.disconnected, target, reason: mode.data, changes: [{ field: 'key', before: row.key_prefix, after: null }] }))
      return true
    })
    if (!removed) return { ok: false, reason: 'NOT_FOUND' }
    await withSystemScope(sql, (tx) => forgetRazorpaySubscriptions(tx, partnerId, mode.data))
    return { ok: true }
  }

  return { account, connect, disconnect }
}

export type PartnerRazorpayService = ReturnType<typeof createPartnerRazorpayService>
export type { GatewayMode }
