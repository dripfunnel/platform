import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { Money } from '#core/money'
import type { TenantContext } from '#core/tenancy'
import { saveReminderFlow, saveReminderStep, selectReminderFlow, selectReminderStore, type StepRow } from '#db/scoped/cartReminders'
import { withScope } from '#db/scoped/index'
import { defaultSteps, levelOf, settingsSchema, type ReminderLevel, type ReminderStepView } from './rules'

// The Reminders tab (FIRST-RELEASE §9): the store's sequence, read by every merchant role and saved by Owner and Manager, in
// the caller's own store scope. What the plan allows is checked here, at the save (SAAS §6.2), and again at every send.

export const cartRemindersAudit = { saved: 'cart_reminders.saved' } as const

export interface ReminderSettingsView {
  enabled: boolean
  minimum: Money | null
  skipOutOfStock: boolean
  quietHours: boolean
  weeklyCap: boolean
  steps: ReminderStepView[]
  /** Null until the store saves its own: the next save names no revision. */
  revision: number | null
  /** What the plan lets the store send, so the tab can lock what it can't (the server refuses it too). */
  level: ReminderLevel
}

export type RemindersRefusal = 'INVALID_INPUT' | 'READ_ONLY' | 'STALE_REVISION' | 'PLAN_LIMIT' | 'NOT_FOUND'
export type RemindersResult<T> = { ok: true; value: T } | { ok: false; reason: Exclude<RemindersRefusal, 'PLAN_LIMIT'> } | { ok: false; reason: 'PLAN_LIMIT'; needs: number }

export interface CartRemindersDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  /** The store's `cart_reminders` index on its plan (saas/entitlements). */
  level: () => Promise<number>
  now: () => Date
}

const stepView = (s: StepRow): ReminderStepView => ({
  position: s.position,
  enabled: s.enabled,
  delayMinutes: s.delay_minutes,
  channel: s.channel,
  subject: s.subject,
  body: s.body,
  discountPercent: s.discount_bps === null ? null : s.discount_bps / 100,
})

/** What a step needs of the plan: a follow-up, a code or WhatsApp all need every reminder (level 2). */
const needsAll = (s: Pick<ReminderStepView, 'position' | 'enabled' | 'channel' | 'discountPercent'>) => (s.position > 1 && s.enabled) || s.discountPercent !== null || s.channel === 'whatsapp'

export const createCartRemindersService = ({ sql, context, actor, activity, facts, level, now }: CartRemindersDeps) => {
  const { storeId } = context
  const supplier = context.sellerScope.kind === 'seller'
  const readOnly = context.caller.kind === 'support' && context.caller.access === 'read'

  const settings = async (): Promise<ReminderSettingsView | null> => {
    if (supplier) return null
    const [{ flow, steps }, index] = await Promise.all([withScope(sql, context, (tx) => selectReminderFlow(tx, storeId)), level()])
    const saved = new Map(steps.map((s) => [s.position, stepView(s)]))
    return {
      enabled: flow?.enabled ?? false,
      minimum: flow?.min_amount && flow.currency ? { amount: BigInt(flow.min_amount), currency: flow.currency } : null,
      skipOutOfStock: flow?.skip_out_of_stock ?? true,
      quietHours: flow?.quiet_hours ?? true,
      weeklyCap: flow?.weekly_cap ?? true,
      steps: defaultSteps.map((d) => saved.get(d.position) ?? d),
      revision: flow?.revision ?? null,
      level: levelOf(index),
    }
  }

  /**
   * Saves the whole sequence at the revision it was read at. A save may keep what the store already has, never add what its
   * plan doesn't allow: automatic sending needs the first level, follow-ups, codes and WhatsApp the last. WhatsApp is for
   * stores in India only (#337).
   */
  /** `input` is checked here against the settings' schema (rules.ts), whoever sends it. */
  const save = async (input: unknown, revision: number | null): Promise<RemindersResult<number>> => {
    if (supplier) return { ok: false, reason: 'NOT_FOUND' }
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    const parsed = settingsSchema.safeParse(input)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const s = parsed.data
    const current = await settings()
    if (!current) return { ok: false, reason: 'NOT_FOUND' }
    if (current.revision !== revision) return { ok: false, reason: 'STALE_REVISION' }
    const index = await level()
    const kept = (step: (typeof s.steps)[number]) => {
      const was = current.revision === null ? null : current.steps.find((x) => x.position === step.position)
      return was !== null && was !== undefined && was.enabled === step.enabled && was.channel === step.channel && was.discountPercent === step.discountPercent
    }
    if (s.enabled && !(current.revision !== null && current.enabled) && index < 1) return { ok: false, reason: 'PLAN_LIMIT', needs: 1 }
    if (index < 2 && s.steps.some((x) => needsAll(x) && !kept(x))) return { ok: false, reason: 'PLAN_LIMIT', needs: 2 }
    const minimum = s.minimum ? { amount: BigInt(s.minimum.amount), currency: s.minimum.currency } : null
    const result = await withScope(sql, context, async (tx) => {
      const store = await selectReminderStore(tx, storeId)
      if (!store) return 'NOT_FOUND' as const
      if (s.steps.some((x) => x.channel === 'whatsapp') && store.country !== 'IN') return 'INVALID_INPUT' as const
      if (minimum && !store.currencies.includes(minimum.currency)) return 'INVALID_INPUT' as const
      const written = await saveReminderFlow(tx, storeId, { enabled: s.enabled, minAmount: minimum?.amount ?? null, currency: minimum?.currency ?? null, skipOutOfStock: s.skipOutOfStock, quietHours: s.quietHours, weeklyCap: s.weeklyCap }, revision, now())
      if (!written) return 'STALE_REVISION' as const
      for (const step of s.steps) {
        await saveReminderStep(tx, storeId, { ...step, discountBps: step.discountPercent === null ? null : step.discountPercent * 100 })
      }
      const changed = (['enabled', 'skipOutOfStock', 'quietHours', 'weeklyCap'] as const).filter((k) => current[k] !== s[k]).map((field) => ({ field, before: current[field], after: s[field] }))
      const entry: ActivityEntry = {
        category: 'write',
        action: cartRemindersAudit.saved,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        target: { type: 'cart_reminders', id: storeId, label: 'Abandoned-cart reminders' },
        reason: null,
        changes: changed,
        api: 'store',
        visibility: 'store',
        ...facts,
      }
      await activity.record(tx, entry)
      return (await selectReminderFlow(tx, storeId)).flow?.revision ?? 1
    })
    return typeof result === 'number' ? { ok: true, value: result } : { ok: false, reason: result }
  }

  return { settings, save }
}
