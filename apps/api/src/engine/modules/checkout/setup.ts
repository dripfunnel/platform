import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { hashSessionId, newSessionId } from '#auth/session'
import { logEvent } from '#core/log'
import { isCardProvider, type OAuthConnect, type PaymentGateways } from '#core/payments'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { saveManualMethod, selectPaymentSetup, selectStoreCountry, turnOffMethod } from '#db/scoped/orders'
import { countLiveMethods, disconnectProvider, savePendingConnect, saveStripeAccount, takeApprovedConnect } from '#db/scoped/payments'
import { isManual, isPaymentProvider, providerLabels, providersFor, type PaymentProvider } from './providers'

// Settings › Payment setup (SetOps; FIRST-RELEASE §19 `gateways`, `connectGateway`, `disconnectGateway`; THIRD-PARTY-ACCESS
// §3.1): the providers for the store's region, Stripe connected by Connect OAuth, the ways paid later turned on with their
// details, and any of them disconnected, never the store's only live one (SetOps).

export const paymentSetupAudit = {
  turnedOn: 'payment_method.turned_on',
  turnedOff: 'payment_method.turned_off',
  connectStarted: 'payment_method.connect_started',
  connected: 'payment_method.connected',
} as const

export type SetupRefusal = 'METHOD_UNAVAILABLE' | 'NOT_FOUND' | 'LAST_METHOD' | 'NOT_AVAILABLE' | 'EXPIRED' | 'SUPPORT_SESSION'
export type SetupResult<T> = { ok: true; value: T } | { ok: false; reason: SetupRefusal }

export interface PaymentSetupView {
  provider: PaymentProvider
  label: string
  /** A card gateway, or another way to get paid (cash on delivery, a transfer), as SetOps groups them. */
  kind: 'gateway' | 'other'
  /** On, and taking payment at checkout. */
  live: boolean
  bankDetails: string | null
  /** Whether it can be connected here today: the platform's Stripe app, or the provider's adapter (part 3). */
  connectable: boolean
}

export interface PaymentSetupDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  gateways: PaymentGateways
  /** The platform's Stripe Connect app; null where it isn't set up (STRIPE_CONNECT_CLIENT_ID). */
  stripeConnect: OAuthConnect | null
  /** The portal host the merchant comes back to from Stripe. */
  host: string
}

// Long enough to sign in to Stripe and approve; the one-time key after it, as Connect Shopify's.
const connectMs = 30 * 60 * 1000
export const finishConnectMs = 10 * 60 * 1000

export const createPaymentSetup = (deps: PaymentSetupDeps) => {
  const { sql, context, actor, activity, facts, now, gateways, stripeConnect } = deps
  const { storeId } = context
  const entry = (action: string, provider: string): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    target: { type: 'payment_method', id: provider, label: isPaymentProvider(provider) ? providerLabels[provider] : provider },
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const connectable = (provider: PaymentProvider): boolean => {
    if (isManual(provider)) return true
    const gateway = gateways[provider]
    if (!gateway || !(gateway.available('live') || gateway.available('test'))) return false
    return provider === 'stripe' ? stripeConnect !== null : true
  }

  const setup = (): Promise<PaymentSetupView[]> =>
    withScope(sql, context, async (tx) => {
      const rows = await selectPaymentSetup(tx, storeId)
      return providersFor(await selectStoreCountry(tx, storeId)).map((provider) => ({
        provider,
        label: providerLabels[provider],
        kind: isManual(provider) ? 'other' : 'gateway',
        live: rows.some((r) => r.provider === provider && r.status === 'live'),
        bankDetails: rows.find((r) => r.provider === provider)?.bank_details ?? null,
        connectable: connectable(provider),
      }))
    })

  /** Cash on delivery (India) or a bank transfer, with the details shoppers transfer to; a card gateway connects with its keys (part 3) or by Connect Stripe. */
  const connect = (provider: string, bankDetails: string | null | undefined): Promise<SetupResult<true>> => {
    const details = bankDetails?.trim() || null
    const method = isManual(provider) ? provider : null
    if (!method || (method === 'bank_transfer' && (!details || details.length > 1000))) return Promise.resolve({ ok: false, reason: 'METHOD_UNAVAILABLE' })
    return withScope(sql, context, async (tx): Promise<SetupResult<true>> => {
      if (!providersFor(await selectStoreCountry(tx, storeId)).includes(method)) return { ok: false, reason: 'METHOD_UNAVAILABLE' }
      await saveManualMethod(tx, storeId, method, method === 'bank_transfer' ? details : null, now())
      await activity.record(tx, entry(paymentSetupAudit.turnedOn, method))
      return { ok: true, value: true }
    })
  }

  /** The address on Stripe to approve DripFunnel's app at; Stripe returns to the hooks host (hooks/stripeConnect.ts). */
  const startStripe = async (): Promise<SetupResult<string>> => {
    // A support session never connects an account for the merchant (ACCESS §8), as with Connect Shopify.
    if (context.caller.kind === 'support') return { ok: false, reason: 'SUPPORT_SESSION' }
    if (!stripeConnect || !connectable('stripe')) return { ok: false, reason: 'NOT_AVAILABLE' }
    const country = await withScope(sql, context, (tx) => selectStoreCountry(tx, storeId))
    if (!providersFor(country).includes('stripe')) return { ok: false, reason: 'METHOD_UNAVAILABLE' }
    const state = newSessionId()
    await withSystemScope(sql, async (tx) => {
      await savePendingConnect(tx, { storeId, stateHash: await hashSessionId(state), returnHost: deps.host, by: actor.id, expiresAt: new Date(now().getTime() + connectMs) })
      await activity.record(tx, entry(paymentSetupAudit.connectStarted, 'stripe'))
    })
    return { ok: true, value: stripeConnect.authorizeUrl(state) }
  }

  /** The callback's one-time key, finished by the person who started it in their own session (login CSRF). */
  const finishStripe = async (key: string): Promise<SetupResult<true>> => {
    if (context.caller.kind === 'support') return { ok: false, reason: 'SUPPORT_SESSION' }
    if (!/^[0-9a-f]{64}$/.test(key)) return { ok: false, reason: 'EXPIRED' }
    return withSystemScope(sql, async (tx): Promise<SetupResult<true>> => {
      const accountId = await takeApprovedConnect(tx, { storeId, finishHash: await hashSessionId(key), by: actor.id, at: now() })
      if (!accountId) return { ok: false, reason: 'EXPIRED' }
      await saveStripeAccount(tx, storeId, accountId, now())
      await activity.record(tx, entry(paymentSetupAudit.connected, 'stripe'))
      return { ok: true, value: true }
    })
  }

  const lastLive = async (tx: ScopedSql, provider: string) => {
    const rows = await selectPaymentSetup(tx, storeId)
    return rows.some((r) => r.provider === provider && r.status === 'live') && (await countLiveMethods(tx, storeId)) <= 1
  }

  /**
   * "Disconnect" or "Turn off": shoppers stop seeing it; orders already paid keep theirs. A card gateway's keys or connected
   * account go with it, and Stripe's access is ended. The store's only live way to pay can't go (SetOps).
   */
  const disconnect = async (provider: string): Promise<SetupResult<true>> => {
    if (!isPaymentProvider(provider)) return { ok: false, reason: 'NOT_FOUND' }
    if (isManual(provider)) {
      return withScope(sql, context, async (tx): Promise<SetupResult<true>> => {
        if (await lastLive(tx, provider)) return { ok: false, reason: 'LAST_METHOD' }
        if (!(await turnOffMethod(tx, storeId, provider, now()))) return { ok: false, reason: 'NOT_FOUND' }
        await activity.record(tx, entry(paymentSetupAudit.turnedOff, provider))
        return { ok: true, value: true }
      })
    }
    if (!isCardProvider(provider)) return { ok: false, reason: 'NOT_FOUND' }
    if (context.caller.kind === 'support' && context.caller.access === 'read') return { ok: false, reason: 'SUPPORT_SESSION' }
    const result = await withSystemScope(sql, async (tx): Promise<SetupResult<string | null>> => {
      if (await lastLive(tx, provider)) return { ok: false, reason: 'LAST_METHOD' }
      const gone = await disconnectProvider(tx, storeId, provider, now())
      if (gone.count === 0) return { ok: false, reason: 'NOT_FOUND' }
      await activity.record(tx, entry(paymentSetupAudit.turnedOff, provider))
      return { ok: true, value: gone.stripeAccount }
    })
    if (!result.ok) return result
    if (result.value && stripeConnect) {
      // Off here already; Stripe keeps a stale grant only until the merchant removes the app there.
      await stripeConnect.deauthorize(result.value).catch((error: unknown) => logEvent({ event: 'stripe_deauthorize_failed', api: 'store', storeId, code: error instanceof Error ? error.name : 'unknown' }))
    }
    return { ok: true, value: true }
  }

  return { setup, connect, startStripe, finishStripe, disconnect }
}
