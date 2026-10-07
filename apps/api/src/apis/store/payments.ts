import { GraphQLError } from 'graphql'
import { checkoutAudit, createPaymentSetup, markPaid, paymentSetupAudit, type CheckoutResult, type PaymentSetupView } from '#engine/modules/checkout/index'
import { isUuid } from '#core/ids'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Settings › Payment setup (SetOps; `payments.configure`, the Owner) and "Mark as paid" (`orders.mark_paid`, Owner and
// Manager, decided 2026-10-05 on #284).

const words: Record<string, string> = {
  METHOD_UNAVAILABLE: 'That way to pay isn’t available here. A bank transfer needs your bank details.',
  NOT_FOUND: 'That is no longer here.',
  NOT_PENDING: 'Only an unpaid cash-on-delivery or bank-transfer order can be marked paid.',
}

const answered = <T>(result: CheckoutResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason] ?? 'Something here isn’t valid.', { extensions: { code: result.reason } })
}

export const registerPayments = (builder: StoreBuilder) => {
  const deps = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return { sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now }
  }

  const Method = builder.objectRef<PaymentSetupView>('PaymentMethodSetup').implement({
    fields: (t) => ({
      provider: t.exposeString('provider'),
      live: t.exposeBoolean('live'),
      bankDetails: t.exposeString('bankDetails', { nullable: true }),
      connectable: t.exposeBoolean('connectable'),
    }),
  })

  const configure = { api: 'store', scope: 'store', permission: 'payments.configure', target: 'none' } as const

  builder.queryFields((t) => ({
    paymentSetup: t.field({ type: [Method], extensions: { access: configure }, resolve: (_, __, ctx) => createPaymentSetup(deps(ctx)).setup() }),
  }))
  builder.mutationFields((t) => ({
    // Cash on delivery (India) or a bank transfer with the details shoppers pay to.
    turnOnPaymentMethod: t.boolean({
      args: { provider: t.arg.string({ required: true }), bankDetails: t.arg.string() },
      extensions: { access: { ...configure, audit: paymentSetupAudit.turnedOn } },
      resolve: async (_, args, ctx) => answered(await createPaymentSetup(deps(ctx)).turnOn(args.provider, args.bankDetails)),
    }),
    turnOffPaymentMethod: t.boolean({
      args: { provider: t.arg.string({ required: true }) },
      extensions: { access: { ...configure, audit: paymentSetupAudit.turnedOff } },
      resolve: async (_, args, ctx) => answered(await createPaymentSetup(deps(ctx)).turnOff(args.provider)),
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
