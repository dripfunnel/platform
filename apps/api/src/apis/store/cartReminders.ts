import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import type { CartReminderRow, CartSummaryRow } from '#db/scoped/cartReminders'
import type { CartLineNow } from '#engine/modules/cart/index'
import {
  cartRemindersAudit,
  cartsAudit,
  createCartRemindersService,
  createCartsService,
  type AbandonedCartDetail,
  type AbandonedCartView,
  type CartsRefusal,
  type CartsResult,
  type RemindersRefusal,
  type RemindersResult,
  type ReminderSettingsView,
  type ReminderStepView,
} from '#engine/modules/cartReminders/index'
import { allowanceFor, planLimitFor } from '#saas/entitlements/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { moneyInputType, moneyType, pageInfoType, type Money, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Abandoned carts' Reminders tab (FIRST-RELEASE §9, §19; Carts): the merchant side's alone. Owner and Manager save it,
// Staff read it (ACCESS §5.1 `carts.read`, `carts.write`); the `store` scope refuses every supplier.

const words: Record<RemindersRefusal | CartsRefusal, string> = {
  CANT_REMIND: 'This cart can’t be reminded: it was bought, its reminders are stopped, it has no email, or it has expired.',
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That isn’t here.',
  READ_ONLY: 'A read-only support session can’t change this store.',
  STALE_REVISION: 'Someone else saved your reminders. Reload to see their changes.',
  PLAN_LIMIT: 'Your plan doesn’t include this.',
}

export const registerCartReminders = (builder: StoreBuilder) => {
  const MoneyType = moneyType(builder)
  const MoneyInput = moneyInputType(builder)

  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const sql = ctx.sql
    const caller = actingCaller(ctx)
    return createCartRemindersService({
      sql,
      context: caller.context,
      actor: { id: caller.person.id, partnerId: caller.person.partnerId },
      activity: ctx.activity,
      facts: ctx.facts,
      level: () => allowanceFor(sql, caller.context, 'cart_reminders', ctx.now()),
      now: ctx.now,
    })
  }

  const carts = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const sql = ctx.sql
    const caller = actingCaller(ctx)
    return createCartsService({
      sql,
      context: caller.context,
      actor: { id: caller.person.id, partnerId: caller.person.partnerId, email: caller.person.email },
      activity: ctx.activity,
      facts: ctx.facts,
      level: () => allowanceFor(sql, caller.context, 'cart_reminders', ctx.now()),
      now: ctx.now,
    })
  }

  const answered = async <T>(ctx: StoreContext, result: RemindersResult<T> | CartsResult<T>): Promise<T> => {
    if (result.ok) return result.value
    if (result.reason === 'PLAN_LIMIT' && ctx.sql) {
      const limit = await planLimitFor(ctx.sql, actingCaller(ctx).context, { key: 'cart_reminders', total: result.needs }, ctx.now())
      throw new GraphQLError(words.PLAN_LIMIT, { extensions: { code: 'PLAN_LIMIT', key: 'cart_reminders', limit: limit?.limit ?? 0, unlockedBy: limit?.unlockedBy ?? null } })
    }
    throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
  }

  const Step = builder.objectRef<ReminderStepView>('ReminderStep').implement({
    fields: (t) => ({
      position: t.exposeInt('position'),
      enabled: t.exposeBoolean('enabled'),
      // Minutes after the shopper leaves: 30, 60, 240, 600, 1440, 2880 or 4320.
      delayMinutes: t.exposeInt('delayMinutes'),
      // email, or whatsapp for a store in India.
      channel: t.exposeString('channel'),
      subject: t.exposeString('subject'),
      body: t.exposeString('body'),
      // 5, 10, 15 or 20: a single-use code for this cart, for 48 hours; null for none.
      discountPercent: t.exposeInt('discountPercent', { nullable: true }),
    }),
  })
  const Settings = builder.objectRef<ReminderSettingsView>('ReminderSettings').implement({
    fields: (t) => ({
      enabled: t.exposeBoolean('enabled'),
      minimum: t.field({ type: MoneyType, nullable: true, resolve: (s) => (s.minimum ? { amount: s.minimum.amount.toString(), currency: s.minimum.currency } : null) }),
      skipOutOfStock: t.exposeBoolean('skipOutOfStock'),
      quietHours: t.exposeBoolean('quietHours'),
      weeklyCap: t.exposeBoolean('weeklyCap'),
      steps: t.field({ type: [Step], resolve: (s) => s.steps }),
      // Null until the store saves its own; the next save sends it back.
      revision: t.exposeInt('revision', { nullable: true }),
      // youSend, onePerCart or automatic: what the plan lets the store send.
      level: t.exposeString('level'),
    }),
  })
  const StepInput = builder.inputType('ReminderStepInput', {
    fields: (t) => ({
      position: t.int({ required: true }),
      enabled: t.boolean({ required: true }),
      delayMinutes: t.int({ required: true }),
      channel: t.string({ required: true }),
      subject: t.string({ required: true }),
      body: t.string({ required: true }),
      discountPercent: t.int(),
    }),
  })
  const SettingsInput = builder.inputType('ReminderSettingsInput', {
    fields: (t) => ({
      enabled: t.boolean({ required: true }),
      minimum: t.field({ type: MoneyInput }),
      skipOutOfStock: t.boolean({ required: true }),
      quietHours: t.boolean({ required: true }),
      weeklyCap: t.boolean({ required: true }),
      steps: t.field({ type: [StepInput], required: true }),
    }),
  })

  const PageInfo = pageInfoType(builder)
  const money = (amount: string | null, currency: string): Money | null => (amount === null ? null : { amount, currency })
  const at = (d: Date | null) => (d ? new Date(d).toISOString() : null)
  const Cart = builder.objectRef<AbandonedCartView>('AbandonedCart').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name', { nullable: true }),
      email: t.exposeString('email', { nullable: true }),
      phone: t.exposeString('phone', { nullable: true }),
      customerId: t.exposeID('customer_id', { nullable: true }),
      // What the cart came to when it was left, before delivery and tax.
      value: t.field({ type: MoneyType, nullable: true, resolve: (c) => money(c.amount, c.currency) }),
      // contact, ship or pay: where they left checkout.
      step: t.exposeString('checkout_step', { nullable: true }),
      abandonedAt: t.string({ resolve: (c) => new Date(c.abandoned_at).toISOString() }),
      // recovered, stopped, no_contact, opted_out, skipped, not_recovered, reminded or waiting.
      status: t.exposeString('status'),
      // Why the last reminder wasn't sent, when it wasn't: out_of_stock, under_minimum, opted_out, weekly_cap, …
      skipReason: t.exposeString('last_skip', { nullable: true }),
      firstItem: t.exposeString('first_item', { nullable: true }),
      lineCount: t.exposeInt('lines'),
      remindersSent: t.exposeInt('sent'),
      lastSentAt: t.string({ nullable: true, resolve: (c) => at(c.last_sent_at) }),
      stoppedAt: t.string({ nullable: true, resolve: (c) => at(c.stopped_at) }),
      stoppedBy: t.exposeString('stopped_by', { nullable: true }),
      stoppedNote: t.exposeString('stopped_note', { nullable: true }),
      recoveredOrderId: t.exposeID('recovered_order_id', { nullable: true }),
      recoveredOrderNumber: t.exposeString('recovered_order_number', { nullable: true }),
      recoveredWithCode: t.exposeBoolean('recovered_with_code'),
    }),
  })
  const CartPage = builder.objectRef<{ nodes: AbandonedCartView[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('AbandonedCartPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Cart], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Counts = builder.objectRef<Record<'open' | 'recovered' | 'lost', number>>('AbandonedCartCounts').implement({
    fields: (t) => ({ open: t.exposeInt('open'), recovered: t.exposeInt('recovered'), lost: t.exposeInt('lost') }),
  })
  const Line = builder.objectRef<CartLineNow>('AbandonedCartLine').implement({
    fields: (t) => ({
      versionId: t.exposeID('versionId'),
      name: t.exposeString('name', { nullable: true }),
      versionName: t.exposeString('versionName', { nullable: true }),
      quantity: t.exposeInt('quantity'),
      lineTotal: t.field({ type: MoneyType, nullable: true, resolve: (l) => (l.lineTotal ? { amount: l.lineTotal.amount.toString(), currency: l.lineTotal.currency } : null) }),
      available: t.exposeInt('available', { nullable: true }),
      outOfStock: t.exposeBoolean('outOfStock'),
    }),
  })
  const Reminder = builder.objectRef<CartReminderRow>('CartReminder').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // 1–3 for a step; null for one sent by hand (sentBy).
      position: t.exposeInt('position', { nullable: true }),
      channel: t.exposeString('channel', { nullable: true }),
      // queued, sent or skipped
      state: t.exposeString('state'),
      skipReason: t.exposeString('skip_reason', { nullable: true }),
      sentBy: t.exposeString('sent_by', { nullable: true }),
      code: t.exposeString('code', { nullable: true }),
      queuedAt: t.string({ resolve: (r) => new Date(r.queued_at).toISOString() }),
      sentAt: t.string({ nullable: true, resolve: (r) => at(r.sent_at) }),
      clickedAt: t.string({ nullable: true, resolve: (r) => at(r.clicked_at) }),
    }),
  })
  const Detail = builder.objectRef<AbandonedCartDetail>('AbandonedCartDetail').implement({
    fields: (t) => ({
      cart: t.field({ type: Cart, resolve: (d) => d }),
      // As it would be bought now: the price here and stock today.
      lines: t.field({ type: [Line], resolve: (d) => d.items }),
      reminders: t.field({ type: [Reminder], resolve: (d) => d.reminders }),
    }),
  })
  const Summary = builder.objectRef<CartSummaryRow & { days: number }>('CartSummary').implement({
    fields: (t) => ({
      days: t.exposeInt('days'),
      abandoned: t.exposeInt('abandoned'),
      leftBehind: t.field({ type: [MoneyType], resolve: (s) => s.left_behind }),
      remindersSent: t.exposeInt('sent'),
      reachable: t.exposeInt('reachable'),
      // Paid within the week after leaving.
      recovered: t.exposeInt('recovered'),
      recoveredSales: t.field({ type: [MoneyType], resolve: (s) => s.recovered_sales }),
      recoveredWithCode: t.exposeInt('with_code'),
    }),
  })
  const tabs = ['open', 'recovered', 'lost'] as const
  const read = { api: 'store', scope: 'store', permission: 'carts.read', target: 'none' } as const
  const write = (audit: string) => ({ api: 'store', scope: 'store', permission: 'carts.write', target: 'none', audit }) as const

  builder.queryFields((t) => ({
    // In progress (open), recovered or not recovered (lost), newest left first.
    abandonedCarts: t.field({
      type: CartPage,
      args: { tab: t.arg.string({ required: true }), search: t.arg.string(), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const tab = tabs.find((x) => x === args.tab)
        if (!tab) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
        const window = storePage(args)
        return pageOf(await carts(ctx).list(tab, args.search ?? null, window), window, (c) => ({ occurredAt: new Date(c.abandoned_at), id: c.id }))
      },
    }),
    abandonedCartCounts: t.field({ type: Counts, extensions: { access: read }, resolve: (_, __, ctx) => carts(ctx).counts() }),
    abandonedCart: t.field({ type: Detail, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: read }, resolve: (_, args, ctx) => carts(ctx).detail(String(args.id)) }),
    // The tiles: the last `days` days (14 unless asked, at most 90).
    cartSummary: t.field({ type: Summary, args: { days: t.arg.int() }, extensions: { access: read }, resolve: async (_, args, ctx) => answered(ctx, await carts(ctx).summary(args.days ?? null)) }),
    reminderSettings: t.field({
      type: Settings,
      nullable: true,
      extensions: { access: { api: 'store', scope: 'store', permission: 'carts.read', target: 'none' } },
      resolve: (_, __, ctx) => service(ctx).settings(),
    }),
  }))

  builder.mutationFields((t) => ({
    // "Send reminder now": by email at once, with a single-use code of 5, 10, 15 or 20% if asked; answers the reminder's id.
    remindNow: t.id({
      args: { cartId: t.arg.id({ required: true }), discountPercent: t.arg.int() },
      extensions: { access: write(cartsAudit.reminderSent) },
      resolve: async (_, args, ctx) => answered(ctx, await carts(ctx).remindNow(String(args.cartId), args.discountPercent ?? null)),
    }),
    stopCartReminders: t.boolean({
      args: { cartId: t.arg.id({ required: true }), note: t.arg.string() },
      extensions: { access: write(cartsAudit.stopped) },
      resolve: async (_, args, ctx) => answered(ctx, await carts(ctx).stop(String(args.cartId), args.note ?? null)),
    }),
    resumeCartReminders: t.boolean({
      args: { cartId: t.arg.id({ required: true }) },
      extensions: { access: write(cartsAudit.resumed) },
      resolve: async (_, args, ctx) => answered(ctx, await carts(ctx).resume(String(args.cartId))),
    }),
    // "Send me a test" of one step, to the person's own email.
    sendTestReminder: t.boolean({
      args: { position: t.arg.int({ required: true }) },
      extensions: { access: write(cartsAudit.testSent) },
      resolve: async (_, args, ctx) => {
        const caller = actingCaller(ctx)
        const allowed = ctx.allowCodeCheck ? await ctx.allowCodeCheck(`test-reminder:${caller.context.storeId}:${caller.person.id}`) : false
        if (!allowed) throw new GraphQLError('Too many tests. Wait a minute and try again.', { extensions: { code: 'RATE_LIMITED' } })
        return answered(ctx, await carts(ctx).sendTest(args.position))
      },
    }),
    // The whole tab at the revision it was read at (null before the first save); answers the new revision.
    saveReminderSettings: t.int({
      args: { revision: t.arg.int(), input: t.arg({ type: SettingsInput, required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'carts.write', target: 'none', audit: cartRemindersAudit.saved } },
      resolve: async (_, args, ctx) => {
        const i = args.input
        const input = {
          enabled: i.enabled,
          minimum: i.minimum ? { amount: i.minimum.amount, currency: i.minimum.currency } : null,
          skipOutOfStock: i.skipOutOfStock,
          quietHours: i.quietHours,
          weeklyCap: i.weeklyCap,
          steps: i.steps.map((s) => ({ position: s.position, enabled: s.enabled, delayMinutes: s.delayMinutes, channel: s.channel, subject: s.subject, body: s.body, discountPercent: s.discountPercent ?? null })),
        }
        return answered(ctx, await service(ctx).save(input, args.revision ?? null))
      },
    }),
  }))
}
