import { isCountry } from '#core/countries'
import { isUuid } from '#core/ids'
import { isCurrency, parseMinor } from '#core/money'
import type { CurrencyWrite, MarketWrite, Rounding } from '#db/scoped/markets'

// What a store's languages, currencies and markets may be (CATALOG N, O; SetStore, SetMarkets), checked before
// anything is written; the database's checks (migration 0051) hold the same lines.

/** BCP 47 tags offered at launch (CATALOG N18, decided on #337); no right-to-left language yet (N17). */
export const offeredLanguages = ['en-IN', 'en-US', 'hi-IN'] as const
export const maxExcludedProducts = 500
const roundings: readonly Rounding[] = ['none', 'nearest', 'ends-99']

export type MarketsRefusal = 'INVALID_LANGUAGE' | 'MAIN_LANGUAGE_REQUIRED' | 'INVALID_CURRENCY' | 'INVALID_COUNTRY' | 'COUNTRIES_REQUIRED' | 'INVALID_INPUT'

export const cleanLanguages = (languages: readonly string[], main: string): { languages: string[]; main: string } | MarketsRefusal => {
  const tags = languages.map((l) => l.trim())
  if (tags.length === 0 || new Set(tags).size !== tags.length || tags.some((t) => !(offeredLanguages as readonly string[]).includes(t))) return 'INVALID_LANGUAGE'
  if (!tags.includes(main.trim())) return 'MAIN_LANGUAGE_REQUIRED'
  return { languages: tags, main: main.trim() }
}

export interface CurrencyInput {
  code: string
  mode: string
  rounding?: string | null | undefined
}

/** The currencies besides the pricing one, in order. */
export const cleanCurrencies = (input: readonly CurrencyInput[], pricingCurrency: string): CurrencyWrite[] | MarketsRefusal => {
  const out: CurrencyWrite[] = []
  for (const c of input) {
    const code = c.code.trim().toUpperCase()
    if (!isCurrency(code) || code === pricingCurrency || out.some((o) => o.currency === code)) return 'INVALID_CURRENCY'
    const rounding = roundings.find((r) => r === (c.rounding ?? 'ends-99'))
    if ((c.mode !== 'manual' && c.mode !== 'convert') || !rounding) return 'INVALID_INPUT'
    out.push({ currency: code, mode: c.mode, rounding })
  }
  return out
}

export interface MarketInput {
  name: string
  parentId?: string | null | undefined
  countries: readonly string[]
  currency: string
  language: string
  priceAdjustmentBps?: number | null | undefined
  webMode?: string | null | undefined
  pathPrefix?: string | null | undefined
  products?: string | null | undefined
  excludedProductIds?: readonly string[] | null | undefined
  dutiesMode?: string | null | undefined
  dutiesRateBps?: number | null | undefined
  dutiesThresholdAmount?: string | null | undefined
  /** SetMarkets' "Delivery charge" in the market's currency; empty is the store's flat rate (SAPI 23). */
  deliveryAmount?: string | null | undefined
  active?: boolean | null | undefined
}

/** A market's fields, cleaned; its currency, language, parent and products are checked against the store after. */
export const cleanMarket = (input: MarketInput): (MarketWrite & { excludedProductIds: string[] }) | MarketsRefusal => {
  const name = input.name.trim()
  const countries = [...new Set(input.countries.map((c) => c.trim().toUpperCase()))]
  if (name === '' || name.length > 60) return 'INVALID_INPUT'
  if (countries.length === 0) return 'COUNTRIES_REQUIRED'
  if (countries.some((c) => !isCountry(c))) return 'INVALID_COUNTRY'
  const currency = input.currency.trim().toUpperCase()
  if (!isCurrency(currency)) return 'INVALID_CURRENCY'
  const parentId = input.parentId ? input.parentId.toLowerCase() : null
  if (parentId !== null && !isUuid(parentId)) return 'INVALID_INPUT'
  const adjustment = input.priceAdjustmentBps ?? 0
  if (!Number.isInteger(adjustment) || adjustment < -9000 || adjustment > 100000) return 'INVALID_INPUT'
  const webMode = input.webMode ?? 'main'
  const pathPrefix = webMode === 'path' ? (input.pathPrefix ?? '').trim().toLowerCase() : null
  if ((webMode !== 'main' && webMode !== 'path') || (pathPrefix !== null && !/^[a-z0-9][a-z0-9-]{0,19}$/.test(pathPrefix))) return 'INVALID_INPUT'
  const products = input.products ?? 'all'
  const excluded = products === 'some' ? [...new Set((input.excludedProductIds ?? []).map((id) => id.toLowerCase()))] : []
  if ((products !== 'all' && products !== 'some') || excluded.length > maxExcludedProducts || !excluded.every(isUuid)) return 'INVALID_INPUT'
  const dutiesMode = input.dutiesMode ?? 'none'
  if (dutiesMode !== 'none' && dutiesMode !== 'by_code' && dutiesMode !== 'flat') return 'INVALID_INPUT'
  const rate = dutiesMode === 'flat' ? (input.dutiesRateBps ?? null) : null
  if (dutiesMode === 'flat' && (rate === null || !Number.isInteger(rate) || rate < 1 || rate > 10000)) return 'INVALID_INPUT'
  // The duty-free threshold is money in the market's own currency (CATALOG T).
  const threshold = dutiesMode === 'none' || !input.dutiesThresholdAmount ? null : parseMinor(input.dutiesThresholdAmount, currency)
  if (dutiesMode !== 'none' && input.dutiesThresholdAmount && !threshold) return 'INVALID_INPUT'
  const delivery = input.deliveryAmount?.trim() ? parseMinor(input.deliveryAmount.trim(), currency) : null
  if (input.deliveryAmount?.trim() && !delivery) return 'INVALID_INPUT'
  return {
    parentId,
    name,
    countries,
    currency,
    language: input.language.trim(),
    priceAdjustmentBps: adjustment,
    webMode,
    pathPrefix,
    products,
    excludedProductIds: excluded,
    dutiesMode,
    dutiesRateBps: rate,
    dutiesThresholdAmount: threshold ? String(threshold.amount) : null,
    deliveryAmount: delivery ? String(delivery.amount) : null,
    active: input.active ?? true,
  }
}
