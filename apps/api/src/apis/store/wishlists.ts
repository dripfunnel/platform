import { pageOf } from '#core/paging'
import { wishlistTabs, type WishlistShopperRow, type WishlistSummaryRow, type WishlistTab } from '#db/scoped/wishlist'
import type { WishlistReminderRow } from '#db/scoped/wishlistReminders'
import {
  createWishlistRemindersService,
  createWishlistsService,
  wishlistRemindersAudit,
  type WishlistItemNow,
  type WishlistRemindersResult,
  type WishlistSettingsView,
  type WishlistShopperDetail,
  type WishlistStepView,
} from '#engine/modules/cartReminders/index'
import { allowanceFor } from '#saas/entitlements/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { answered } from './cartReminders'
import { moneyType, pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'
import { assetUrl } from './products'

// The Carts screen's Wishlists tab (#1215; FIRST-RELEASE §9): who saved what, read only. Every merchant role reads it
// (ACCESS §5.1 `carts.read`); the `store` scope refuses every supplier.

export const registerWishlists = (builder: StoreBuilder) => {
  const MoneyType = moneyType(builder)
  const PageInfo = pageInfoType(builder)

  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    return createWishlistsService({ sql: ctx.sql, context: actingCaller(ctx).context, now: ctx.now })
  }

  const reminders = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const sql = ctx.sql
    const caller = actingCaller(ctx)
    return createWishlistRemindersService({
      sql,
      context: caller.context,
      actor: { id: caller.person.id, partnerId: caller.person.partnerId },
      activity: ctx.activity,
      facts: ctx.facts,
      level: () => allowanceFor(sql, caller.context, 'cart_reminders', ctx.now()),
      now: ctx.now,
    })
  }
  const cantRemind = 'This shopper can’t be reminded: their reminders are stopped, they have no email, or their wishlist is empty.'
  const answer = <T>(ctx: StoreContext, result: WishlistRemindersResult<T>) => answered(ctx, result, cantRemind)

  const Shopper = builder.objectRef<WishlistShopperRow>('WishlistShopper').implement({
    fields: (t) => ({
      customerId: t.exposeID('customer_id'),
      name: t.exposeString('name', { nullable: true }),
      email: t.exposeString('email', { nullable: true }),
      items: t.exposeInt('items'),
      lastSavedAt: t.string({ resolve: (s) => new Date(s.last_saved_at).toISOString() }),
      // The newest saved product's name (the list); null in the detail.
      firstProduct: t.exposeString('first_product', { nullable: true }),
      remindersSent: t.exposeInt('sent'),
      lastSentAt: t.string({ nullable: true, resolve: (s) => (s.last_sent_at ? new Date(s.last_sent_at).toISOString() : null) }),
      stoppedAt: t.string({ nullable: true, resolve: (s) => (s.stopped_at ? new Date(s.stopped_at).toISOString() : null) }),
      stoppedBy: t.exposeString('stopped_by', { nullable: true }),
      stoppedNote: t.exposeString('stopped_note', { nullable: true }),
    }),
  })
  const Counts = builder.objectRef<Record<WishlistTab, number>>('WishlistShopperCounts').implement({
    fields: (t) => ({ waiting: t.exposeInt('waiting'), reminded: t.exposeInt('reminded'), stopped: t.exposeInt('stopped') }),
  })
  const Summary = builder.objectRef<WishlistSummaryRow & { days: number }>('WishlistSummary').implement({
    fields: (t) => ({
      days: t.exposeInt('days'),
      shoppers: t.exposeInt('shoppers'),
      products: t.exposeInt('products'),
      // Shoppers with an email whose reminders are not stopped.
      reachable: t.exposeInt('reachable'),
      remindersSent: t.exposeInt('reminders_sent'),
      reminded: t.exposeInt('reminded'),
    }),
  })
  const Reminder = builder.objectRef<WishlistReminderRow>('WishlistReminder').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // 1–3 for a step; null for one sent by hand (sentBy).
      position: t.exposeInt('position', { nullable: true }),
      // queued, sent or skipped
      state: t.exposeString('state'),
      skipReason: t.exposeString('skip_reason', { nullable: true }),
      sentBy: t.exposeString('sent_by', { nullable: true }),
      queuedAt: t.string({ resolve: (r) => new Date(r.queued_at).toISOString() }),
      sentAt: t.string({ nullable: true, resolve: (r) => (r.sent_at ? new Date(r.sent_at).toISOString() : null) }),
    }),
  })
  const Step = builder.objectRef<WishlistStepView>('WishlistReminderStep').implement({
    fields: (t) => ({
      position: t.exposeInt('position'),
      enabled: t.exposeBoolean('enabled'),
      // Minutes after the shopper last saved: 30, 60, 240, 600, 1440, 2880 or 4320.
      delayMinutes: t.exposeInt('delayMinutes'),
      subject: t.exposeString('subject'),
      body: t.exposeString('body'),
    }),
  })
  const Settings = builder.objectRef<WishlistSettingsView>('WishlistReminderSettings').implement({
    fields: (t) => ({
      enabled: t.exposeBoolean('enabled'),
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
  const StepInput = builder.inputType('WishlistReminderStepInput', {
    fields: (t) => ({
      position: t.int({ required: true }),
      enabled: t.boolean({ required: true }),
      delayMinutes: t.int({ required: true }),
      subject: t.string({ required: true }),
      body: t.string({ required: true }),
    }),
  })
  const SettingsInput = builder.inputType('WishlistReminderSettingsInput', {
    fields: (t) => ({
      enabled: t.boolean({ required: true }),
      skipOutOfStock: t.boolean({ required: true }),
      quietHours: t.boolean({ required: true }),
      weeklyCap: t.boolean({ required: true }),
      steps: t.field({ type: [StepInput], required: true }),
    }),
  })
  const Item = builder.objectRef<WishlistItemNow>('WishlistShopperItem').implement({
    fields: (t) => ({
      productId: t.exposeID('productId'),
      name: t.exposeString('name'),
      photoUrl: t.string({ nullable: true, resolve: (w) => (w.photoAssetId ? assetUrl(w.photoAssetId) : null) }),
      inStock: t.exposeBoolean('inStock'),
      // The cheapest version's price in the store's currency.
      price: t.field({ type: MoneyType, nullable: true, resolve: (w) => (w.price ? { amount: w.price.amount.toString(), currency: w.price.currency } : null) }),
    }),
  })
  const Page = builder.objectRef<{ nodes: WishlistShopperRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('WishlistShopperPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Shopper], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Detail = builder.objectRef<WishlistShopperDetail>('WishlistShopperDetail').implement({
    fields: (t) => ({ shopper: t.field({ type: Shopper, resolve: (d) => d }), items: t.field({ type: [Item], resolve: (d) => d.products }), reminders: t.field({ type: [Reminder], resolve: (d) => d.reminders }) }),
  })
  const read = { api: 'store', scope: 'store', permission: 'carts.read', target: 'none' } as const
  const write = (audit: string) => ({ api: 'store', scope: 'store', permission: 'carts.write', target: 'none', audit }) as const

  builder.queryFields((t) => ({
    // Shoppers with a wishlist, the newest saved first; search finds a name, an email or a product.
    wishlistShoppers: t.field({
      type: Page,
      args: { tab: t.arg.string(), search: t.arg.string(), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).list(wishlistTabs.find((t) => t === args.tab) ?? null, args.search ?? null, window), window, (s) => ({ occurredAt: new Date(s.last_saved_at), id: s.customer_id }))
      },
    }),
    // How many shoppers each tab holds, and the tiles above them (the last `days`, 14 unless asked).
    wishlistShopperCounts: t.field({ type: Counts, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).counts() }),
    wishlistSummary: t.field({ type: Summary, nullable: true, args: { days: t.arg.int() }, extensions: { access: read }, resolve: (_, args, ctx) => service(ctx).summary(args.days ?? null) }),
    wishlistShopper: t.field({ type: Detail, nullable: true, args: { customerId: t.arg.id({ required: true }) }, extensions: { access: read }, resolve: (_, args, ctx) => service(ctx).detail(String(args.customerId)) }),
    // The Wishlists tab's reminders: the sequence, and what the plan lets the store send.
    wishlistReminderSettings: t.field({ type: Settings, nullable: true, extensions: { access: read }, resolve: (_, __, ctx) => reminders(ctx).settings() }),
  }))

  builder.mutationFields((t) => ({
    // "Send reminder now": by email at once; answers the reminder's id.
    remindWishlistNow: t.id({
      args: { customerId: t.arg.id({ required: true }) },
      extensions: { access: write(wishlistRemindersAudit.sent) },
      resolve: async (_, args, ctx) => answer(ctx, await reminders(ctx).remindNow(String(args.customerId))),
    }),
    stopWishlistReminders: t.boolean({
      args: { customerId: t.arg.id({ required: true }), note: t.arg.string() },
      extensions: { access: write(wishlistRemindersAudit.stopped) },
      resolve: async (_, args, ctx) => answer(ctx, await reminders(ctx).stop(String(args.customerId), args.note ?? null)),
    }),
    resumeWishlistReminders: t.boolean({
      args: { customerId: t.arg.id({ required: true }) },
      extensions: { access: write(wishlistRemindersAudit.resumed) },
      resolve: async (_, args, ctx) => answer(ctx, await reminders(ctx).resume(String(args.customerId))),
    }),
    // The whole tab at the revision it was read at (null before the first save); answers the new revision.
    saveWishlistReminderSettings: t.int({
      args: { revision: t.arg.int(), input: t.arg({ type: SettingsInput, required: true }) },
      extensions: { access: write(wishlistRemindersAudit.saved) },
      resolve: async (_, args, ctx) => {
        const i = args.input
        const input = { enabled: i.enabled, skipOutOfStock: i.skipOutOfStock, quietHours: i.quietHours, weeklyCap: i.weeklyCap, steps: i.steps.map((x) => ({ position: x.position, enabled: x.enabled, delayMinutes: x.delayMinutes, subject: x.subject, body: x.body })) }
        return answer(ctx, await reminders(ctx).save(input, args.revision ?? null))
      },
    }),
  }))
}
