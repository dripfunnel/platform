import { GraphQLError } from 'graphql'
import { cartRemindersAudit, createCartRemindersService, type RemindersRefusal, type RemindersResult, type ReminderSettingsView, type ReminderStepView } from '#engine/modules/cartReminders/index'
import { allowanceFor, planLimitFor } from '#saas/entitlements/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { moneyInputType, moneyType, type StoreBuilder } from './builder'

// Abandoned carts' Reminders tab (FIRST-RELEASE §9, §19; Carts): the merchant side's alone. Owner and Manager save it,
// Staff read it (ACCESS §5.1 `carts.read`, `carts.write`); the `store` scope refuses every supplier.

const words: Record<RemindersRefusal, string> = {
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

  const answered = async <T>(ctx: StoreContext, result: RemindersResult<T>): Promise<T> => {
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

  builder.queryFields((t) => ({
    reminderSettings: t.field({
      type: Settings,
      nullable: true,
      extensions: { access: { api: 'store', scope: 'store', permission: 'carts.read', target: 'none' } },
      resolve: (_, __, ctx) => service(ctx).settings(),
    }),
  }))

  builder.mutationFields((t) => ({
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
