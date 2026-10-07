import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { hashSessionId, newSessionId } from '#auth/session'
import { logEvent } from '#core/log'
import type { SecretBox } from '#auth/secretBox'
import { isCardProvider, PaymentRefused, PaymentUnavailable, type OAuthConnect, type PaymentGateways, type PaymentMode } from '#core/payments'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { saveManualMethod, selectPaymentSetup, selectStoreCountry, turnOffMethod } from '#db/scoped/orders'
import { countLiveMethods, disconnectProvider, saveKeyedAccount, savePendingConnect, saveStripeAccount, stripeAccountTaken, takeApprovedConnect } from '#db/scoped/payments'
import { cleanCredentials, isKeyedProvider } from './credentials'
import { isManual, isPaymentProvider, providerLabels, providersFor, type PaymentProvider } from './providers'

// Settings › Payment setup (SetOps; FIRST-RELEASE §19 `gateways`, `connectGateway`, `disconnectGateway`;
// THIRD-PARTY-ACCESS §3.1).

export const paymentSetupAudit = {
  turnedOn: 'payment_method.turned_on',
  turnedOff: 'payment_method.turned_off',
  connectStarted: 'payment_method.connect_started',
  connected: 'payment_method.connected',
} as const

export type SetupRefusal = 'METHOD_UNAVAILABLE' | 'NOT_FOUND' | 'LAST_METHOD' | 'NOT_AVAILABLE' | 'EXPIRED' | 'SUPPORT_SESSION' | 'ACCOUNT_IN_USE' | 'INVALID_KEYS' | 'KEYS_REFUSED' | 'PROVIDER_UNAVAILABLE'
export type SetupResult<T> = { ok: true; value: T } | { ok: false; reason: SetupRefusal }

export interface PaymentSetupView {
  provider: PaymentProvider
  label: string
  /** A card gateway, or another way to get paid (cash on delivery, a transfer), as SetOps groups them. */
  kind: 'gateway' | 'other'
  /** On, and taking payment at checkout. */
  live: boolean
  bankDetails: string | null
  /** Whether it can be connected here today: the platform's Stripe app, or the credential key for pasted keys. */
  connectable: boolean
  /** Each mode connected, with the address to give the provider for its webhooks (pasted keys only; Stripe needs none). */
  connections: { mode: PaymentMode; live: boolean; webhookUrl: string | null }[]
}

/** What Payment setup's "Connect" sends: a transfer's details, or a card provider's keys for a mode. */
export interface ConnectInput {
  bankDetails?: string | null | undefined
  mode?: PaymentMode | null | undefined
  credentials?: Record<string, string | null | undefined> | null | undefined
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
  /** Seals pasted keys (THIRD-PARTY-ACCESS §5); null where CREDENTIALS_KEK isn't set. */
  secrets: SecretBox | null
  /** The store's own webhook address for a provider account (hooks/payments.ts). */
  webhookUrl: (provider: string, accountId: string) => string
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
    return provider === 'stripe' ? stripeConnect !== null : deps.secrets !== null
  }

  const setup = (): Promise<PaymentSetupView[]> =>
    withScope(sql, context, async (tx) => {
      const rows = await selectPaymentSetup(tx, storeId)
      return providersFor(await selectStoreCountry(tx, storeId)).map((provider) => ({
        provider,
        label: providerLabels[provider],
        kind: isManual(provider) ? 'other' : 'gateway',
        // Taking payment on the live storefront; test keys show in `connections` only.
        live: rows.some((r) => r.provider === provider && r.status === 'live' && r.mode === 'live'),
        bankDetails: rows.find((r) => r.provider === provider)?.bank_details ?? null,
        connectable: connectable(provider),
        connections: rows
          .filter((r) => r.provider === provider && r.status === 'live')
          .map((r) => ({ mode: r.mode, live: r.status === 'live', webhookUrl: isCardProvider(provider) && isKeyedProvider(provider) && r.status === 'live' ? deps.webhookUrl(provider, r.id) : null })),
      }))
    })

  /** A card provider's keys for a mode, checked, tried once with the provider and sealed (THIRD-PARTY-ACCESS §3.1). */
  const connectKeys = async (provider: string, input: ConnectInput): Promise<SetupResult<true>> => {
    if (!isPaymentProvider(provider) || !isCardProvider(provider) || !isKeyedProvider(provider)) return { ok: false, reason: 'METHOD_UNAVAILABLE' }
    const mode = input.mode ?? 'live'
    const clean = input.credentials ? cleanCredentials(provider, mode, input.credentials) : null
    if (!clean) return { ok: false, reason: 'INVALID_KEYS' }
    const gateway = gateways[provider]
    if (!gateway || !deps.secrets) return { ok: false, reason: 'NOT_AVAILABLE' }
    const country = await withScope(sql, context, (tx) => selectStoreCountry(tx, storeId))
    if (!providersFor(country).includes(provider)) return { ok: false, reason: 'METHOD_UNAVAILABLE' }
    try {
      await gateway.verify?.({ mode, externalAccountId: null, credentials: clean.credentials })
    } catch (error) {
      if (error instanceof PaymentRefused) return { ok: false, reason: 'KEYS_REFUSED' }
      if (error instanceof PaymentUnavailable) return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
      throw error
    }
    const sealed = await deps.secrets.seal(JSON.stringify(clean.credentials))
    return withSystemScope(sql, async (tx): Promise<SetupResult<true>> => {
      await saveKeyedAccount(tx, { storeId, provider, mode, credentialsEnc: sealed, publicKey: clean.publicKey, now: now() })
      await activity.record(tx, { ...entry(paymentSetupAudit.turnedOn, provider), reason: mode })
      return { ok: true, value: true }
    })
  }

  /** Cash on delivery (India) or a bank transfer, with the details shoppers transfer to; a card provider by its keys. */
  const connect = (provider: string, input: ConnectInput): Promise<SetupResult<true>> => {
    // A support session never changes how the store is paid (ACCESS §8).
    if (context.caller.kind === 'support') return Promise.resolve({ ok: false, reason: 'SUPPORT_SESSION' })
    if (isCardProvider(provider)) return connectKeys(provider, input)
    const details = input.bankDetails?.trim() || null
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
    // Stripe returns to this host with the one-time key: never to one that isn't the portal's.
    if (!stripeConnect || !connectable('stripe') || deps.host === '') return { ok: false, reason: 'NOT_AVAILABLE' }
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
      if (await stripeAccountTaken(tx, storeId, accountId)) return { ok: false, reason: 'ACCOUNT_IN_USE' }
      await saveStripeAccount(tx, storeId, accountId, now())
      await activity.record(tx, entry(paymentSetupAudit.connected, 'stripe'))
      return { ok: true, value: true }
    })
  }

  const lastLive = async (tx: ScopedSql, provider: string) => {
    // The store's ways to pay, locked, so two disconnects at once can't both pass the count.
    await tx`select 1 from payment_provider_account where store_id = ${storeId} for update`
    const rows = await selectPaymentSetup(tx, storeId)
    return rows.some((r) => r.provider === provider && r.status === 'live' && r.mode === 'live') && (await countLiveMethods(tx, storeId)) <= 1
  }

  /** "Disconnect": keys and connected account go, Stripe's access ends; never the store's only live way to pay (SetOps). */
  const disconnect = async (provider: string): Promise<SetupResult<true>> => {
    if (!isPaymentProvider(provider)) return { ok: false, reason: 'NOT_FOUND' }
    if (context.caller.kind === 'support') return { ok: false, reason: 'SUPPORT_SESSION' }
    if (isManual(provider)) {
      return withScope(sql, context, async (tx): Promise<SetupResult<true>> => {
        if (await lastLive(tx, provider)) return { ok: false, reason: 'LAST_METHOD' }
        if (!(await turnOffMethod(tx, storeId, provider, now()))) return { ok: false, reason: 'NOT_FOUND' }
        await activity.record(tx, entry(paymentSetupAudit.turnedOff, provider))
        return { ok: true, value: true }
      })
    }
    if (!isCardProvider(provider)) return { ok: false, reason: 'NOT_FOUND' }
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
