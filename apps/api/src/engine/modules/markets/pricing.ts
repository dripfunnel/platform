import { applyBps, convert, minorDigits, roundPrice, type Money, type PriceRounding } from '#core/money'

// What a version costs in each of the store's currencies and in a market (CATALOG facts 25–26, O2, O10–O11):
// a typed price always wins; a converted currency is computed from the pricing price at the reference rate,
// rounded as the store asks; anything else isn't for sale in that currency.

export interface StorePricing {
  pricingCurrency: string
  /** The store's active currencies besides the pricing one. */
  currencies: readonly { currency: string; mode: 'manual' | 'convert'; rounding: PriceRounding }[]
  /** Units per euro by currency (migration 0052); the euro is 1 whether listed or not. */
  perEuro: ReadonlyMap<string, string>
}

export interface TypedPrice {
  currency: string
  amount: string
  compare_at_amount: string | null
}

export type PriceSource = 'typed' | 'converted'

export interface CurrencyPrice {
  currency: string
  /** Null: not for sale in this currency yet (O2's "until you add a price", or no rate to convert at). */
  amount: bigint | null
  compareAt: bigint | null
  source: PriceSource | null
}

const rateOf = (pricing: StorePricing, currency: string) => (currency === 'EUR' ? '1' : (pricing.perEuro.get(currency) ?? null))

const converted = (amount: bigint, pricing: StorePricing, to: string, rounding: PriceRounding): bigint | null => {
  const from = rateOf(pricing, pricing.pricingCurrency)
  const target = rateOf(pricing, to)
  if (!from || !target) return null
  const money = convert({ amount, currency: pricing.pricingCurrency }, to, from, target)
  return money ? roundPrice(money, rounding).amount : null
}

export const priceInCurrency = (prices: readonly TypedPrice[], currency: string, pricing: StorePricing): CurrencyPrice => {
  const typed = prices.find((p) => p.currency === currency)
  if (typed) return { currency, amount: BigInt(typed.amount), compareAt: typed.compare_at_amount === null ? null : BigInt(typed.compare_at_amount), source: 'typed' }
  const setting = pricing.currencies.find((c) => c.currency === currency)
  const base = prices.find((p) => p.currency === pricing.pricingCurrency)
  if (!setting || setting.mode !== 'convert' || !base) return { currency, amount: null, compareAt: null, source: null }
  const amount = converted(BigInt(base.amount), pricing, currency, setting.rounding)
  if (amount === null) return { currency, amount: null, compareAt: null, source: null }
  // O11: the compare-at price converts by the same rule unless typed.
  const compareAt = base.compare_at_amount === null ? null : converted(BigInt(base.compare_at_amount), pricing, currency, setting.rounding)
  return { currency, amount, compareAt, source: 'converted' }
}

/** Every currency the store sells in, the pricing one first. */
export const pricesByCurrency = (prices: readonly TypedPrice[], pricing: StorePricing): CurrencyPrice[] =>
  [pricing.pricingCurrency, ...pricing.currencies.map((c) => c.currency)].map((currency) => priceInCurrency(prices, currency, pricing))

/** A market's price: its currency's, moved by its adjustment and rounded as that currency is (SetMarkets "+10%"). */
export const priceInMarket = (prices: readonly TypedPrice[], market: { currency: string; price_adjustment_bps: number }, pricing: StorePricing): CurrencyPrice => {
  const base = priceInCurrency(prices, market.currency, pricing)
  if (base.amount === null || market.price_adjustment_bps === 0) return base
  const rounding = pricing.currencies.find((c) => c.currency === market.currency)?.rounding ?? 'none'
  const moved = (amount: bigint): bigint => roundPrice(applyBps({ amount, currency: market.currency } satisfies Money, 10_000 + market.price_adjustment_bps), rounding).amount
  return { ...base, amount: moved(base.amount), compareAt: base.compareAt === null ? null : moved(base.compareAt) }
}

export interface ConversionExample {
  currency: string
  from: Money
  /** What `from` comes to in `currency` under each rounding; null without a rate. */
  to: Record<PriceRounding, Money | null>
}

/** Settings' "₹100 → $1.99" (SetStore, O4–O5): 100 of the pricing currency through the same conversion and rounding as a price. */
export const conversionExamples = (pricing: StorePricing, currencies: readonly string[]): ConversionExample[] => {
  const from: Money = { amount: 100n * 10n ** BigInt(minorDigits(pricing.pricingCurrency)), currency: pricing.pricingCurrency }
  const at = (currency: string, rounding: PriceRounding) => {
    const amount = converted(from.amount, pricing, currency, rounding)
    return amount === null ? null : { amount, currency }
  }
  return currencies.filter((c) => c !== pricing.pricingCurrency).map((currency) => ({ currency, from, to: { none: at(currency, 'none'), nearest: at(currency, 'nearest'), 'ends-99': at(currency, 'ends-99') } }))
}
