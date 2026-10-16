import type { ShippingInput, ShippingSettings } from '../../../api/settingsShipping'
import { minorOf, moneyText } from '../../../format'

/** The longest collection hours the API keeps (apps/api src/engine/modules/shipping/rules.ts). */
export const pickupHoursMax = 120

/** What the form edits: amounts as typed in major units, which `inputOf` turns into the API's minor units. */
export type Draft = {
  courierRate: boolean
  flatRate: boolean
  flat: string
  pickup: boolean
  hours: string
  freeMode: ShippingSettings['freeMode']
  threshold: string
  areaMode: ShippingSettings['areaMode']
}

const draftKeys = ['courierRate', 'flatRate', 'flat', 'pickup', 'hours', 'freeMode', 'threshold', 'areaMode'] as const

const typed = (minor: string | null, currency: string): string => (minor === null ? '' : moneyText({ amount: minor, currency }))

export const draftOf = (settings: ShippingSettings): Draft => ({
  courierRate: settings.courierRate,
  flatRate: settings.flatRate,
  flat: typed(settings.flatAmount, settings.currency),
  pickup: settings.pickup,
  hours: settings.pickupHours ?? '',
  freeMode: settings.freeMode,
  threshold: typed(settings.freeThresholdAmount, settings.currency),
  areaMode: settings.areaMode,
})

/** A courier change or a list read back: what was edited stays, the rest follows the server. */
export const rebase = (draft: Draft, before: Draft, after: Draft): Draft => {
  const next = { ...after }
  for (const key of draftKeys) if (draft[key] !== before[key]) Object.assign(next, { [key]: draft[key] })
  return next
}

export const same = (a: Draft, b: Draft): boolean => draftKeys.every((key) => a[key] === b[key])

export type Missing = 'method' | 'courier' | 'amount' | 'flat' | 'threshold' | 'hours' | 'list'

/** What a save sends, or the first rule it breaks. Both amounts go as minor-unit digit strings of the store's currency. */
export const inputOf = (draft: Draft, settings: ShippingSettings): ShippingInput | Missing => {
  const flatShown = draft.flatRate || draft.courierRate
  const flat = flatShown ? minorOf(draft.flat, settings.currency) : null
  const threshold = draft.freeMode === 'over' ? minorOf(draft.threshold, settings.currency) : null
  if (!draft.courierRate && !draft.flatRate && !draft.pickup) return 'method'
  if (draft.courierRate && !settings.couriers.some((courier) => courier.status === 'pricing')) return 'courier'
  if (flat === 'invalid' || threshold === 'invalid') return 'amount'
  if (draft.flatRate && flat === null) return 'flat'
  if (draft.freeMode === 'over' && threshold === null) return 'threshold'
  if (draft.pickup && draft.hours.trim() === '') return 'hours'
  if (draft.areaMode === 'list' && settings.areaCount === 0) return 'list'
  return {
    courierRate: draft.courierRate,
    flatRate: draft.flatRate,
    flatAmount: flat,
    pickup: draft.pickup,
    pickupHours: draft.hours.trim() || null,
    freeMode: draft.freeMode,
    freeThresholdAmount: threshold,
    areaMode: draft.areaMode,
  }
}
