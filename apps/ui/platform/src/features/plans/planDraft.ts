import type { Money } from '@dripfunnel/shared/format'
import { allowanceKeys, limitKeys, toggleKeys, type EntitlementKey, type NumberKey, type Plan, type PlanCeilings, type PlanInput, type ToggleKey } from '../../api/plans'
import { sameJson } from '../common/sameJson'

// The editor's draft: text as typed, so a half-typed price or limit is kept until it is saved.
export interface PlanDraft {
  name: string
  description: string
  trialDays: string
  prices: Record<string, { monthly: string; yearly: string }>
  toggles: Record<ToggleKey, boolean>
  numbers: Record<NumberKey, string>
}

// How many minor-unit digits a currency has, from Intl, so a 0-decimal currency is typed and shown as whole units.
const digitsOf = (currency: string) => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2

const textOfMoney = (money: Money | null) => (money ? (money.amount / 10 ** digitsOf(money.currency)).toFixed(digitsOf(money.currency)) : '')

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
  toggles: Object.fromEntries(toggleKeys.map((key) => [key, plan?.entitlements[key] ?? false])) as Record<ToggleKey, boolean>,
  numbers: Object.fromEntries([...limitKeys, ...allowanceKeys].map((key) => [key, plan ? String(plan.entitlements[key]) : ''])) as Record<NumberKey, string>,
})

export const isDirty = (draft: PlanDraft, original: PlanDraft) => !sameJson(draft, original)

// "49" or "49.00" in major units to the currency's minor units; empty is unpriced; anything else is invalid.
export const minorOf = (text: string, currency: string): Money['amount'] | null | 'invalid' => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const digits = digitsOf(currency)
  if (!new RegExp(`^\\d{1,7}${digits > 0 ? `(\\.\\d{1,${digits}})?` : ''}$`).test(trimmed)) return 'invalid'
  const [whole = '0', fraction = ''] = trimmed.split('.')
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0')
}

export const numberOf = (text: string) => Number(text.replace(/\D/g, '') || '0')

// Rows the API would refuse: above a ceiling, or "Powered by" removed when the contract forbids it.
export const rowsAboveCeiling = (draft: PlanDraft, ceilings: PlanCeilings): EntitlementKey[] => [
  ...[...limitKeys, ...allowanceKeys].filter((key) => {
    const max = ceilings[key]
    return max !== null && numberOf(draft.numbers[key]) > max
  }),
  ...(draft.toggles.powered && !ceilings.powered.allowed ? (['powered'] as const) : []),
]

// Limits and allowances left blank: a new plan starts with none, and the API needs every one.
export const rowsMissing = (draft: PlanDraft): NumberKey[] => [...limitKeys, ...allowanceKeys].filter((key) => draft.numbers[key].trim() === '')

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
      ...(Object.fromEntries([...limitKeys, ...allowanceKeys].map((key) => [key, numberOf(draft.numbers[key])])) as Record<NumberKey, number>),
    },
  }
}
