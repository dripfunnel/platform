import { minorOf, moneyText, type Money } from '@dripfunnel/shared/format'
import { type EntitlementKey, type Plan, type PlanCeilings, type PlanInput } from '../../api/plans'
import { planKeyDefs, UNLIMITED } from '../../api/planKeys'
import { sameJson } from '../common/sameJson'

// The editor's draft: text as typed, so a half-typed price or limit is kept until it is saved.
export interface PlanDraft {
  name: string
  description: string
  trialDays: string
  prices: Record<string, { monthly: string; yearly: string }>
  toggles: Record<string, boolean>
  numbers: Record<string, string>
}

export const switchKeys = planKeyDefs.filter((d) => d.kind === 'switch').map((d) => d.key)
export const numberKeys = planKeyDefs.filter((d) => d.kind !== 'switch').map((d) => d.key)
// A new plan starts blank on the limits the API checks, and at the first choice or zero on the rest.
const defaultText = (key: string) => (planKeyDefs.find((d) => d.key === key)?.enforced ? '' : '0')
export const isUnlimited = (text: string) => numberOf(text) === UNLIMITED

const textOfMoney = (money: Money | null) => (money ? moneyText(money) : '')

export const draftOf = (plan: Plan | null, currencies: readonly string[], defaultTrial: number): PlanDraft => ({
  name: plan?.name ?? '',
  description: plan?.description ?? '',
  trialDays: String(plan?.trialDays ?? defaultTrial),
  prices: Object.fromEntries(
    currencies.map((currency) => {
      const price = plan?.prices.find((candidate) => candidate.currency === currency)
      return [currency, { monthly: textOfMoney(price?.monthly ?? null), yearly: textOfMoney(price?.yearly ?? null) }]
    }),
  ),
  toggles: Object.fromEntries(switchKeys.map((key) => [key, plan?.entitlements[key] === true])),
  numbers: Object.fromEntries(numberKeys.map((key) => [key, plan ? String(plan.entitlements[key] ?? 0) : defaultText(key)])),
})

export const isDirty = (draft: PlanDraft, original: PlanDraft) => !sameJson(draft, original)

export const numberOf = (text: string) => Number(text.replace(/\D/g, '') || '0')

// Rows the API would refuse: above a ceiling, or "Powered by" removed when the contract forbids it.
export const rowsAboveCeiling = (draft: PlanDraft, ceilings: PlanCeilings): EntitlementKey[] => [
  ...numberKeys.filter((key) => {
    const max = ceilings.amounts[key]
    return max !== null && max !== undefined && numberOf(draft.numbers[key] ?? '') > max
  }),
  ...(draft.toggles['powered_by_removal'] && !ceilings.powered.allowed ? ['powered_by_removal'] : []),
]

// Limits and allowances left blank: a new plan starts with none, and the API needs every one.
export const rowsMissing = (draft: PlanDraft): string[] => numberKeys.filter((key) => (draft.numbers[key] ?? '').trim() === '')

export const hasInvalidPrice = (draft: PlanDraft) => Object.entries(draft.prices).some(([currency, price]) => minorOf(price.monthly, currency) === 'invalid' || minorOf(price.yearly, currency) === 'invalid')

// The draft as the API's input; null while a price is not a number or a limit is blank.
export const inputOf = (draft: PlanDraft): PlanInput | null => {
  if (hasInvalidPrice(draft) || rowsMissing(draft).length > 0) return null
  const prices = Object.entries(draft.prices).map(([currency, price]) => {
    const monthly = minorOf(price.monthly, currency)
    const yearly = minorOf(price.yearly, currency)
    return {
      currency,
      monthly: typeof monthly === 'number' ? { amount: monthly, currency } : null,
      yearly: typeof yearly === 'number' ? { amount: yearly, currency } : null,
    }
  })
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    trialDays: Number(draft.trialDays),
    prices,
    entitlements: {
      ...draft.toggles,
      ...Object.fromEntries(numberKeys.map((key) => [key, numberOf(draft.numbers[key] ?? '')])),
    },
  }
}
