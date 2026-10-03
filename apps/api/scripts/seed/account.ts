import type { ScopedSql } from '#db/scoped/index'
import type { AmountKey } from '#db/scoped/plans'
import { insertLimitOverride, insertSubscription, insertTrialExtension, setUsage, type SubscriptionStatus } from '#db/scoped/storeAccount'

// The account fields #212 adds, laid over the stores the seed already made: a subscription for
// every store on a plan, stored usage, and Northstar's variety (designs/partner-data.js): four
// stores near a limit, two overrides and a trial extension.

interface SeededStore {
  id: string
  name: string
  status: string
  suspended_previous_status: string | null
  trial_ends_at: Date | null
  partner_id: string
  plan_id: string
  version: number
  currency: string | null
  monthly: number | null
  yearly: number | null
  products: number | null
  staff: number | null
  publish: number | null
  ai: number | null
}

const subscriptionStatus = (s: SeededStore): SubscriptionStatus => {
  const status = s.status === 'suspended' ? s.suspended_previous_status : s.status
  return status === 'trial' || status === 'past_due' || status === 'cancelled' ? status : status === 'closed' ? 'cancelled' : 'active'
}

export const seedAccounts = async (tx: ScopedSql, partnerKeys: ReadonlyMap<string, string>, now: Date): Promise<void> => {
  const northstarId = partnerKeys.get('ns')
  const rows = await tx<SeededStore[]>`
    select s.id, s.name, s.status, s.suspended_previous_status, s.trial_ends_at, s.partner_id, s.plan_id, pl.version,
      pr.currency, pr.monthly_amount as monthly, pr.yearly_amount as yearly,
      (select amount from plan_entitlement e where e.plan_id = pl.id and e.version = pl.version and e.key = 'products') as products,
      (select amount from plan_entitlement e where e.plan_id = pl.id and e.version = pl.version and e.key = 'staff') as staff,
      (select amount from plan_entitlement e where e.plan_id = pl.id and e.version = pl.version and e.key = 'publish_now') as publish,
      (select amount from plan_entitlement e where e.plan_id = pl.id and e.version = pl.version and e.key = 'ai_prompts') as ai
    from store s join plan pl on pl.id = s.plan_id
    left join lateral (select currency, monthly_amount, yearly_amount from plan_price where plan_id = pl.id and version = pl.version order by currency limit 1) pr on true
    order by s.name, s.id
  `
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const nextYear = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), 1))
  let near = 0
  let northstar = 0
  let extended = false
  for (const [i, s] of rows.entries()) {
    const status = subscriptionStatus(s)
    const yearly = i % 5 === 0 && s.yearly !== null
    await insertSubscription(tx, {
      store_id: s.id,
      partner_id: s.partner_id,
      plan_id: s.plan_id,
      plan_version: s.version,
      status,
      interval: yearly ? 'year' : 'month',
      currency: s.currency ?? 'USD',
      amount: (yearly ? s.yearly : s.monthly) ?? 0,
      period_start: month,
      period_end: yearly ? nextYear : nextMonth,
      trial_ends_at: status === 'trial' ? s.trial_ends_at : null,
      payment_method_last4: status === 'trial' ? null : String(4000 + (i % 6000)).padStart(4, '0'),
    })
    const ns = s.partner_id === northstarId
    if (ns) northstar += 1
    // Northstar's first four active stores sit between 90 and 99 % of their product limit.
    const nearLimit = ns && status === 'active' && near < 4
    if (nearLimit) near += 1
    const share = nearLimit ? 0.9 + near / 50 : ((i * 37) % 70) / 100
    const usage: [AmountKey, number | null, Date | null][] = [
      ['products', s.products === null ? null : Math.floor(s.products * share), null],
      ['staff', s.staff === null ? null : Math.min(s.staff, 1 + (i % 3)), null],
      ['publish_now', s.publish === null ? null : Math.floor(s.publish * share), month],
      ['ai_prompts', s.ai === null ? null : Math.floor(s.ai * share), month],
    ]
    for (const [key, used, period] of usage) if (used !== null) await setUsage(tx, s.id, key, used, period, now)

    if (ns && northstar <= 2) {
      await insertLimitOverride(tx, {
        storeId: s.id,
        key: northstar === 1 ? 'products' : 'publish_now',
        amount: northstar === 1 ? (s.products ?? 0) + 500 : (s.publish ?? 0) + 20,
        duration: northstar === 1 ? 'always' : 'month',
        month: northstar === 1 ? null : month,
        reason: northstar === 1 ? 'Holiday catalogue while they move to Pro' : 'Launch week',
        by: { kind: 'partner_user', label: 'Diego Alvarez' },
        at: new Date(now.getTime() - (5 + northstar) * 86_400_000),
      })
    }
    if (ns && status === 'trial' && s.trial_ends_at && !extended) {
      extended = true
      await insertTrialExtension(tx, { storeId: s.id, days: 7, endsAt: s.trial_ends_at, reason: 'Waiting on their payment provider', by: { kind: 'partner_user', label: 'Diego Alvarez' }, at: new Date(now.getTime() - 2 * 86_400_000) })
    }
  }
}
