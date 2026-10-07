import { GraphQLError } from 'graphql'
import { isUuid } from '#core/ids'
import { checkoutAudit, createPaymentSetup, markPaid, paymentSetupAudit, type CheckoutResult, type PaymentSetupView } from '#engine/modules/checkout/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Settings › Payment setup (SetOps; FIRST-RELEASE §19 `gateways`, `connectGateway`, `disconnectGateway`; `payments.configure`,
// the Owner) and "Mark as paid" (`orders.mark_paid`, Owner and Manager, decided 2026-10-05 on #284).

const words: Record<string, string> = {
  METHOD_UNAVAILABLE: 'That way to pay isn’t available here. A bank transfer needs your bank details.',
  NOT_FOUND: 'That is no longer here.',
  NOT_PENDING: 'Only an unpaid cash-on-delivery or bank-transfer order can be marked paid.',
  LAST_METHOD: 'You can’t turn off your only way to get paid — shoppers couldn’t buy anything.',
  NOT_AVAILABLE: 'Connecting Stripe isn’t set up here yet.',
  EXPIRED: 'That link has expired. Connect Stripe again.',
  ACCOUNT_IN_USE: 'That Stripe account already takes payments for another store. Connect a different Stripe account.',
  SUPPORT_SESSION: 'A support session can’t connect or disconnect payments. Someone in the store does it from their own account.',
  INVALID_KEYS: 'Those keys aren’t in the shape this provider gives them. Copy them again from its dashboard, for the mode you chose.',
  KEYS_REFUSED: 'The provider didn’t accept those keys. Check them in its dashboard and try again.',
  PROVIDER_UNAVAILABLE: 'We couldn’t reach the provider to check those keys. Try again in a minute.',
  READ_ONLY: 'This store is read-only.',
}

const answered = <T>(result: CheckoutResult<T> | { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason] ?? 'Something here isn’t valid.', { extensions: { code: result.reason } })
}

export const registerPayments = (builder: StoreBuilder) => {
  const deps = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return { sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now }
  }
  const setup = (ctx: StoreContext) =>
    createPaymentSetup({
      ...deps(ctx),
      gateways: ctx.payments?.gateways ?? {},
      stripeConnect: ctx.payments?.stripeConnect ?? null,
      host: ctx.host ?? '',
      secrets: ctx.secrets ?? null,
      webhookUrl: ctx.payments?.webhookUrl ?? (() => ''),
    })

  const Connection = builder.objectRef<PaymentSetupView['connections'][number]>('PaymentGatewayConnection').implement({
    fields: (t) => ({
      // test (the preview storefront) or live.
      mode: t.exposeString('mode'),
      live: t.exposeBoolean('live'),
      // Paste into the provider's webhook settings; null for Stripe, which needs none.
      webhookUrl: t.exposeString('webhookUrl', { nullable: true }),
    }),
  })
  const Mode = builder.enumType('PaymentMode', { values: ['TEST', 'LIVE'] as const })
  // Each provider's own names (THIRD-PARTY-ACCESS §3.1); a field another provider uses is refused. Never read back.
  const Keys = builder.inputType('PaymentGatewayKeysInput', {
    fields: (t) => ({
      keyId: t.string(),
      keySecret: t.string(),
      webhookSecret: t.string(),
      appId: t.string(),
      secretKey: t.string(),
      clientId: t.string(),
      clientSecret: t.string(),
      clientVersion: t.string(),
      webhookUsername: t.string(),
      webhookPassword: t.string(),
      webhookId: t.string(),
    }),
  })

  const Gateway = builder.objectRef<PaymentSetupView>('PaymentGateway').implement({
    fields: (t) => ({
      provider: t.exposeString('provider'),
      label: t.exposeString('label'),
      // gateway, or other (cash on delivery, a bank transfer), as Payment setup groups them.
      kind: t.exposeString('kind'),
      live: t.exposeBoolean('live'),
      bankDetails: t.exposeString('bankDetails', { nullable: true }),
      connectable: t.exposeBoolean('connectable'),
      connections: t.field({ type: [Connection], resolve: (g) => g.connections }),
    }),
  })

  const configure = { api: 'store', scope: 'store', permission: 'payments.configure', target: 'none' } as const

  builder.queryFields((t) => ({
    gateways: t.field({ type: [Gateway], extensions: { access: configure }, resolve: (_, __, ctx) => setup(ctx).setup() }),
  }))
  builder.mutationFields((t) => ({
    // Cash on delivery (India) or a bank transfer with the details shoppers pay to; a card provider's keys for a mode.
    connectGateway: t.boolean({
      args: { provider: t.arg.string({ required: true }), bankDetails: t.arg.string(), mode: t.arg({ type: Mode }), keys: t.arg({ type: Keys }) },
      extensions: { access: { ...configure, audit: paymentSetupAudit.turnedOn } },
      resolve: async (_, args, ctx) =>
        answered(await setup(ctx).connect(args.provider, { bankDetails: args.bankDetails, mode: args.mode === 'TEST' ? 'test' : args.mode === 'LIVE' ? 'live' : null, credentials: args.keys ?? null })),
    }),
    // The address on Stripe to approve DripFunnel's app at; Stripe brings the merchant back with a one-time key.
    connectStripe: t.string({
      extensions: { access: { ...configure, audit: paymentSetupAudit.connectStarted } },
      resolve: async (_, __, ctx) => answered(await setup(ctx).startStripe()),
    }),
    finishStripeConnect: t.boolean({
      args: { key: t.arg.string({ required: true }) },
      extensions: { access: { ...configure, audit: paymentSetupAudit.connected } },
      resolve: async (_, args, ctx) => answered(await setup(ctx).finishStripe(args.key)),
    }),
    // Shoppers stop seeing it at checkout; orders already paid aren't affected.
    disconnectGateway: t.boolean({
      args: { provider: t.arg.string({ required: true }) },
      extensions: { access: { ...configure, audit: paymentSetupAudit.turnedOff } },
      resolve: async (_, args, ctx) => answered(await setup(ctx).disconnect(args.provider)),
    }),
    markOrderPaid: t.boolean({
      args: { orderId: t.arg.id({ required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'orders.mark_paid', target: 'none', audit: checkoutAudit.markedPaid } },
      resolve: async (_, args, ctx) => {
        const id = String(args.orderId).toLowerCase()
        if (!isUuid(id)) throw new GraphQLError(words['NOT_FOUND'] ?? '', { extensions: { code: 'NOT_FOUND' } })
        return answered(await markPaid(deps(ctx), id))
      },
    }),
  }))
}
