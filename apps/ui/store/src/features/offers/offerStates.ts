import type { CodeBatch, Offer, OfferAction, OfferCounts, OfferResults } from '../../api/offers'

// Offers' states under ?state= (ui/README.md §6): loading, error, empty, list, noMatch, staff, readOnly, denied, locked.
// `locked` is the offer page's results on a plan without them.
export const offerStates = ['loading', 'error', 'empty', 'list', 'noMatch', 'staff', 'readOnly', 'denied', 'locked'] as const
export type OfferState = (typeof offerStates)[number]

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const day = 86_400_000
const at = (days: number) => new Date(Date.now() + days * day).toISOString()
const inr = (amount: string) => [{ amount, currency: 'INR' }]
const noTargets = { productIds: [], collectionIds: [], filterValueIds: [] }
const action = (a: Partial<OfferAction> & Pick<OfferAction, 'operation'>): OfferAction => ({ percent: null, amounts: [], cap: [], targets: null, exclude: null, buy: null, get: null, oncePerOrder: false, kind: null, tiers: [], ...a })
const leaf = { amounts: [], minimum: null, productIds: [], collectionIds: [], filterValueIds: [], groupIds: [], customerIds: [], countries: [], days: [], from: null, to: null, conditions: [] }
const none = { product: false, order: false, shipping: false }
const base = { internalName: null, code: null, enabled: true, startsAt: null, endsAt: null, totalUsesLimit: null, perCustomerLimit: null, usesCount: 0, combines: none, conditions: [], revision: 1 }

const offers: Offer[] = harness
  ? [
      { ...base, id: 'o1', name: 'Festive linen 20% off', trigger: 'automatic', status: 'live', startsAt: at(-12), endsAt: at(1.5), usesCount: 38, action: action({ operation: 'products_percentage_discount', percent: 20, targets: { ...noTargets, filterValueIds: ['fv-linen'] }, exclude: { giftCards: true, onSale: false } }) },
      { ...base, id: 'o2', name: 'Welcome 10% off', trigger: 'code', code: 'WELCOME10', status: 'live', startsAt: at(-200), perCustomerLimit: 1, usesCount: 112, conditions: [{ ...leaf, operation: 'first_order' }], action: action({ operation: 'order_percentage_discount', percent: 10 }) },
      { ...base, id: 'o3', name: 'Free delivery over ₹999', trigger: 'automatic', status: 'live', usesCount: 264, conditions: [{ ...leaf, operation: 'minimum_order_amount', amounts: inr('99900') }], action: action({ operation: 'free_shipping' }) },
      { ...base, id: 'o9', name: 'Instagram single-use 15%', trigger: 'code', status: 'live', perCustomerLimit: 1, usesCount: 37, action: action({ operation: 'order_percentage_discount', percent: 15 }) },
      { ...base, id: 'o7', name: 'VIP 15% off', trigger: 'code', code: 'VIP15', status: 'live', usesCount: 46, combines: { product: true, order: false, shipping: true }, conditions: [{ ...leaf, operation: 'customer_group', groupIds: ['g1'] }], action: action({ operation: 'order_percentage_discount', percent: 15 }) },
    ]
  : []

const others: Record<'scheduled' | 'off' | 'ended', Offer[]> = harness
  ? {
      scheduled: [{ ...base, id: 'o5', name: 'Diwali 15% off', trigger: 'code', code: 'DIWALI15', status: 'scheduled', startsAt: at(3), endsAt: at(12), perCustomerLimit: 1, action: action({ operation: 'order_percentage_discount', percent: 15 }) }],
      off: [{ ...base, id: 'o4', name: 'Socks: buy 2, get 1 free', trigger: 'automatic', status: 'off', enabled: false, usesCount: 21, action: action({ operation: 'buy_x_get_y', percent: 100, buy: { quantity: 2, targets: { ...noTargets, productIds: ['p11'] } }, get: { quantity: 1, targets: null } }) }],
      ended: [
        { ...base, id: 'o6', name: 'Monsoon 20% off', trigger: 'code', code: 'MONSOON20', status: 'ended', startsAt: at(-100), endsAt: at(-40), usesCount: 204, action: action({ operation: 'products_percentage_discount', percent: 20, targets: { ...noTargets, filterValueIds: ['fv-cotton'] } }) },
        { ...base, id: 'o8', name: 'Flash sale 50% off silk', trigger: 'code', code: 'FLASH50', status: 'used_up', totalUsesLimit: 50, usesCount: 50, endsAt: at(2), action: action({ operation: 'products_percentage_discount', percent: 50, targets: { ...noTargets, productIds: ['p8'] } }) },
      ],
    }
  : { scheduled: [], off: [], ended: [] }

export interface OfferSample {
  live: Offer[]
  scheduled: Offer[]
  off: Offer[]
  ended: Offer[]
  counts: OfferCounts
}

export const offerSample = (state: OfferState | null): OfferSample | null => {
  if (!harness || !state || state === 'loading' || state === 'error' || state === 'denied') return null
  if (state === 'empty') return { live: [], scheduled: [], off: [], ended: [], counts: { live: 0, scheduled: 0, off: 0, ended: 0 } }
  const all = { live: offers, ...others }
  const counts = { live: all.live.length, scheduled: all.scheduled.length, off: all.off.length, ended: all.ended.length }
  return state === 'noMatch' ? { live: [], scheduled: [], off: [], ended: [], counts } : { ...all, counts }
}

export const sampleNames = harness
  ? { collections: new Map<string, string>(), filterValues: new Map([['fv-linen', 'Fabric: Linen'], ['fv-cotton', 'Fabric: Cotton']]), groups: new Map([['g1', 'VIP']]) }
  : null

export const sampleResults: OfferResults | null = harness
  ? { uses: 38, discountGiven: inr('4120000'), salesWithOffer: inr('22100000'), averageOrder: inr('581500'), byDay: Array.from({ length: 14 }, (_, i) => ({ day: new Date(Date.now() - (13 - i) * day).toISOString().slice(0, 10), uses: [2, 3, 1, 4, 2, 0, 3, 5, 2, 1, 4, 3, 6, 2][i] ?? 0 })) }
  : null

export const sampleBatches: CodeBatch[] = harness ? [{ id: 'b1', prefix: 'INSTA-', length: 8, count: 500, used: 37, createdAt: at(-5) }] : []
