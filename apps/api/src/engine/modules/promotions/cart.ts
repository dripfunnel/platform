import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { selectCartOffers, selectCartShopper, selectProductTargets, selectSharedCodes, selectShopperUses, type CartOfferRow } from '#db/scoped/promotions'
import { codeAnswerOf, localTimeIn, parseAction, parseCondition, statusOf, type Condition } from './definition'
import { priceOffers, type PricingOffer, type PricingResult } from './pricing'

// A cart's offers (OFFERS-DESIGN §3 facts 5–8, 16): read in system scope, since a shopper reads no offer's rules or codes,
// and priced by pricing.ts. Placement counts the uses (checkout); this only says what applies now.

/** Per code the cart holds: applied, or why not, in the words OFFERS O3 gives the storefront. */
export type CodeState = 'APPLIED' | 'NOT_ELIGIBLE' | 'DOESNT_COMBINE' | 'INVALID' | 'EXPIRED' | 'USED_UP' | 'ALREADY_USED' | 'SIGN_IN_REQUIRED'

/** States that take a code straight back off the cart: nothing a shopper adds to it would make it work. */
export const deadCodeStates: readonly CodeState[] = ['INVALID', 'EXPIRED', 'USED_UP', 'ALREADY_USED']

export interface CartOfferLine {
  /** The cart line's id: two lines of a version with different answers are priced apart (#1368). */
  key: string
  versionId: string
  productId: string
  quantity: number
  amount: bigint
  /** The customisation extras inside `amount`, which an offer with "Include customisation extras" off never discounts. */
  extras: bigint
  giftCard: boolean
  onSale: boolean
}

export interface CartOffersInput {
  storeId: string
  /** The cart being priced: a reminder's code works on its own cart only. */
  cartId: string | null
  currency: string
  codes: readonly string[]
  /** The signed-in shopper; a guest is null, whatever contact they typed. */
  customerId: string | null
  country: string | null
  lines: readonly CartOfferLine[]
  shipping: bigint | null
  now: Date
}

export interface CartDiscount {
  offerId: string
  codeId: string | null
  code: string | null
  name: string
  amount: bigint
  perCustomerLimit: number | null
}

export interface CartOffers {
  pricing: PricingResult
  discounts: CartDiscount[]
  codes: { code: string; state: CodeState }[]
}

/** Shareable codes priced per cart read, and offers listed. */
const maxCandidates = 50
const maxListed = 5

const pricingOf = (row: CartOfferRow): PricingOffer | null => {
  const conditions = row.conditions.map((c) => parseCondition({ operation: c.operation, ...c.args }))
  const action = row.action ? parseAction({ operation: row.action.operation, ...row.action.args }) : null
  if (!action || conditions.some((c) => c === null)) return null
  return { id: row.id, name: row.name, codeId: row.code_id, createdAt: row.created_at, conditions: conditions as Condition[], action, combines: row.combines_with, includeExtras: row.include_customisation }
}

const firstOrderIn = (conditions: readonly Condition[]) => conditions.some((c) => c.operation === 'first_order' || (c.operation === 'any_of' && c.conditions.some((x) => x.operation === 'first_order')))

/** What pricing the offers reads; `productIds` may still be coming, so the cart's own reads run alongside (#1590). */
export const loadCartOffers = (sql: postgres.Sql, input: Pick<CartOffersInput, 'storeId' | 'codes' | 'customerId' | 'now'> & { shared?: boolean }, productIds: Promise<readonly string[]>) =>
  withSystemScope(sql, async (tx) => {
    const { storeId, customerId } = input
    // `shared`: the store's shareable codes are read too, for availableOffersOf (#1698); pricing still names only the cart's.
    const codes = input.shared ? [...input.codes, ...(await selectSharedCodes(tx, storeId, input.now, maxCandidates))] : input.codes
    const [rows, shopper] = await Promise.all([selectCartOffers(tx, storeId, codes, input.now), selectCartShopper(tx, storeId, customerId)])
    const [uses, targets] = await Promise.all([
      selectShopperUses(tx, storeId, [...new Set(rows.filter((r) => r.per_customer_limit !== null).map((r) => r.id))], customerId),
      productIds.then((ids) => selectProductTargets(tx, storeId, [...new Set(ids)])),
    ])
    return { rows, uses, shopper, targets }
  })
export type CartOfferFacts = Awaited<ReturnType<typeof loadCartOffers>>

export interface AvailableOffer {
  offerId: string
  name: string
  code: string
  /** What applying it changes in the cart's discount, today: always more than 0. */
  saves: bigint
}

/**
 * The shared codes (loaded with `shared`) the cart would take now and gain from, best first (#1698). Each is priced on top
 * of the codes already held, so who it is for, its limits and what it combines with decide, as for a shopper typing it.
 */
export const availableOffersOf = (facts: CartOfferFacts, input: CartOffersInput): AvailableOffer[] => {
  const held = new Set(input.codes.map((c) => c.toLowerCase()))
  const before = priceCartOffers(facts, input).pricing.discount
  const listed: AvailableOffer[] = []
  for (const row of facts.rows) {
    if (row.trigger !== 'code' || !row.code || held.has(row.code.toLowerCase())) continue
    const priced = priceCartOffers(facts, { ...input, codes: [...input.codes, row.code] })
    const state = priced.codes.find((c) => c.code === row.code)?.state
    const saves = priced.pricing.discount - before
    if (state === 'APPLIED' && saves > 0n) listed.push({ offerId: row.id, name: row.name, code: row.code, saves })
  }
  return listed.sort((a, b) => (a.saves === b.saves ? 0 : a.saves > b.saves ? -1 : 1)).slice(0, maxListed)
}

export const priceCartOffers = ({ rows, uses, shopper, targets }: CartOfferFacts, input: CartOffersInput): CartOffers => {
  const { now, customerId } = input
  const states = new Map<string, CodeState>()
  const offers: PricingOffer[] = []
  const limits = new Map<string, number | null>()
  const held = new Set(input.codes.map((c) => c.toLowerCase()))
  for (const row of rows) {
    // Rows read for availableOffersOf name codes the cart doesn't hold: they price nothing.
    if (row.trigger === 'code' && !(row.code && held.has(row.code.toLowerCase()))) continue
    const status = statusOf({ enabled: row.enabled && !row.deleted, startsAt: row.starts_at, endsAt: row.ends_at, usesCount: row.uses_count, totalUsesLimit: row.total_uses_limit }, now)
    if (row.code) {
      // An automatic offer's old code is no code at all, but the offer itself still applies.
      const answer = row.trigger === 'code' && (row.code_order_id === null || row.code_order_id === input.cartId) ? codeAnswerOf(row, status, now) : 'INVALID'
      if (answer !== 'WORKS') states.set(row.code, answer)
      if (answer !== 'WORKS' && row.trigger === 'code') continue
    }
    if ((row.trigger === 'automatic' && status !== 'live') || offers.some((o) => o.id === row.id)) continue
    const offer = pricingOf(row.trigger === 'code' ? row : { ...row, code_id: null })
    if (!offer) continue
    // Once per customer and first order only need to know who the shopper is, which a typed email or number never says,
    // and an answer that turned on one would tell anyone another shopper's history (ACCESS §2.1).
    const limit = row.per_customer_limit
    if ((limit !== null || firstOrderIn(offer.conditions)) && customerId === null) {
      if (row.code) states.set(row.code, 'SIGN_IN_REQUIRED')
      continue
    }
    if (limit !== null && (uses.get(row.id) ?? 0) >= limit) {
      if (row.code) states.set(row.code, 'ALREADY_USED')
      continue
    }
    offers.push(offer)
    limits.set(row.id, limit)
  }
  const pricing = priceOffers({
    currency: input.currency,
    lines: input.lines.map((l) => ({
      id: l.key,
      productId: l.productId,
      quantity: l.quantity,
      amount: l.amount,
      extras: l.extras,
      collectionIds: targets.get(l.productId)?.collections ?? [],
      filterValueIds: targets.get(l.productId)?.filterValues ?? [],
      giftCard: l.giftCard,
      onSale: l.onSale,
    })),
    shipping: input.shipping,
    shopper: { customerId, groupIds: shopper.group_ids, firstOrder: customerId !== null && !shopper.has_ordered, country: input.country },
    local: localTimeIn(now, shopper.time_zone),
    offers,
  })
  const codeOf = new Map(rows.filter((r) => r.code_id).map((r) => [r.code_id, r.code]))
  for (const a of pricing.applied) {
    const code = a.codeId ? codeOf.get(a.codeId) : null
    if (code) states.set(code, 'APPLIED')
  }
  for (const n of pricing.notApplied) {
    const code = rows.find((r) => r.id === n.offerId && r.code)?.code
    if (code && !states.has(code)) states.set(code, n.reason === 'DOESNT_COMBINE' ? 'DOESNT_COMBINE' : 'NOT_ELIGIBLE')
  }
  const byLower = new Map([...states].map(([code, state]) => [code.toLowerCase(), state]))
  return {
    pricing,
    discounts: pricing.applied.map((a) => ({ offerId: a.offerId, codeId: a.codeId, code: a.codeId ? (codeOf.get(a.codeId) ?? null) : null, name: a.name, amount: a.amount, perCustomerLimit: limits.get(a.offerId) ?? null })),
    // A code no offer of this store holds is as invalid as one that never worked: one answer (fact 6).
    codes: input.codes.map((code) => ({ code, state: byLower.get(code.toLowerCase()) ?? 'INVALID' })),
  }
}
