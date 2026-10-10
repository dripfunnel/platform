import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { selectCartOffers, selectCartShopper, selectProductTargets, selectShopperUses, type CartOfferRow } from '#db/scoped/promotions'
import { codeAnswerOf, localTimeIn, parseAction, parseCondition, statusOf, type Condition } from './definition'
import { priceOffers, type PricingOffer, type PricingResult } from './pricing'

// A cart's offers (OFFERS-DESIGN §3 facts 5–8, 16): read in system scope, since a shopper reads no offer's rules or codes,
// and priced by pricing.ts. Placement counts the uses (checkout); this only says what applies now.

/** Per code the cart holds: applied, or why not, in the words OFFERS O3 gives the storefront. */
export type CodeState = 'APPLIED' | 'NOT_ELIGIBLE' | 'DOESNT_COMBINE' | 'INVALID' | 'EXPIRED' | 'USED_UP' | 'ALREADY_USED' | 'SIGN_IN_REQUIRED'

/** States that take a code straight back off the cart: nothing a shopper adds to it would make it work. */
export const deadCodeStates: readonly CodeState[] = ['INVALID', 'EXPIRED', 'USED_UP', 'ALREADY_USED']

export interface CartOfferLine {
  versionId: string
  productId: string
  quantity: number
  amount: bigint
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

const pricingOf = (row: CartOfferRow): PricingOffer | null => {
  const conditions = row.conditions.map((c) => parseCondition({ operation: c.operation, ...c.args }))
  const action = row.action ? parseAction({ operation: row.action.operation, ...row.action.args }) : null
  if (!action || conditions.some((c) => c === null)) return null
  return { id: row.id, name: row.name, codeId: row.code_id, createdAt: row.created_at, conditions: conditions as Condition[], action, combines: row.combines_with }
}

const firstOrderIn = (conditions: readonly Condition[]) => conditions.some((c) => c.operation === 'first_order' || (c.operation === 'any_of' && c.conditions.some((x) => x.operation === 'first_order')))

export const cartOffers = async (sql: postgres.Sql, input: CartOffersInput): Promise<CartOffers> => {
  const { storeId, now } = input
  const { customerId } = input
  const { rows, uses, shopper, targets } = await withSystemScope(sql, async (tx) => {
    const rows = await selectCartOffers(tx, storeId, input.codes, now)
    return {
      rows,
      uses: await selectShopperUses(tx, storeId, [...new Set(rows.filter((r) => r.per_customer_limit !== null).map((r) => r.id))], customerId),
      shopper: await selectCartShopper(tx, storeId, customerId),
      targets: await selectProductTargets(tx, storeId, [...new Set(input.lines.map((l) => l.productId))]),
    }
  })
  const states = new Map<string, CodeState>()
  const offers: PricingOffer[] = []
  const limits = new Map<string, number | null>()
  for (const row of rows) {
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
      id: l.versionId,
      productId: l.productId,
      quantity: l.quantity,
      amount: l.amount,
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
