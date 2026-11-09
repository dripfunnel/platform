import type { QuestionRow } from '#db/scoped/questions'
import { priceInCurrency, priceInMarket, type StorePricing } from '#engine/modules/markets/index'

// A product's questions as a shopper sees them (CATALOG facts 49–57; FIRST-RELEASE §19 `ShopProduct.questions`): in the
// shopper's language, each amount in the cart's currency and market, as a version's price is (CATALOG facts 25–26).

/** An extra's amount for the line's version in the cart's currency and market: null where it isn't sold in it. */
export interface ShopExtraPrice {
  mode: 'fixed' | 'percent' | 'per_character'
  per: 'item' | 'line'
  bps: number | null
  /** The amount for every version; null when it has none in this currency (not available here, fact 51). */
  amount: bigint | null
  /** A version's own amount, which wins over `amount` for that version. */
  byVersion: ReadonlyMap<string, bigint | null>
}

export interface ShopChoice {
  id: string
  label: string
  mainLabel: string
  position: number
  available: boolean
  maxQuantity: number
  photoAssetId: string | null
  price: ShopExtraPrice | null
}

export interface ShopQuestion {
  id: string
  kind: 'choice' | 'text' | 'upload'
  label: string
  /** The main language's, beside the shopper's on the order (DATA-MODEL §7.6). */
  mainLabel: string
  help: string | null
  required: boolean
  minPicks: number | null
  maxPicks: number | null
  freePicks: number | null
  maxLength: number | null
  multiline: boolean | null
  example: string | null
  accept: 'image' | 'pdf' | 'image_pdf' | null
  maxFiles: number | null
  price: ShopExtraPrice | null
  shownIfChoiceId: string | null
  /** Empty: every version. */
  versionIds: readonly string[]
  choices: readonly ShopChoice[]
}

export interface QuestionPricing {
  currency: string
  market: { currency: string; price_adjustment_bps: number }
  pricing: StorePricing
}

/** Translated text by `${entity}:${id}:${field}`; the row's own words are the main language's. */
export type QuestionWords = ReadonlyMap<string, string>

const priceOf = (row: { price_mode: QuestionRow['price_mode']; price_bps: number | null; price_per: QuestionRow['price_per']; amounts: QuestionRow['amounts'] }, f: QuestionPricing): ShopExtraPrice | null => {
  if (!row.price_mode || !row.price_per) return null
  // Typed amounts as prices: a manual currency's typed one wins, a converting one is computed, anything else isn't sold here.
  const inCart = (typed: readonly { currency: string; amount: string }[]): bigint | null => {
    const prices = typed.map((a) => ({ currency: a.currency, amount: a.amount, compare_at_amount: null }))
    return (f.market.currency === f.currency ? priceInMarket(prices, f.market, f.pricing) : priceInCurrency(prices, f.currency, f.pricing)).amount
  }
  const general = row.amounts.filter((a) => a.version_id === null)
  const versions = [...new Set(row.amounts.flatMap((a) => (a.version_id ? [a.version_id] : [])))]
  return {
    mode: row.price_mode,
    per: row.price_per,
    bps: row.price_bps,
    amount: row.price_mode === 'percent' ? null : inCart(general),
    byVersion: new Map(versions.map((v) => [v, inCart(row.amounts.filter((a) => a.version_id === v))])),
  }
}

/** The questions as the shop reads them, translated where the store has, priced for the cart. */
export const shopQuestionsOf = (rows: readonly QuestionRow[], words: QuestionWords, f: QuestionPricing): ShopQuestion[] =>
  rows.map((q) => ({
    id: q.id,
    kind: q.kind,
    label: words.get(`question:${q.id}:name`) ?? q.label,
    mainLabel: q.label,
    help: q.help === null ? null : (words.get(`question:${q.id}:description`) ?? q.help),
    required: q.required,
    minPicks: q.min_picks,
    maxPicks: q.max_picks,
    freePicks: q.free_picks,
    maxLength: q.max_length,
    multiline: q.multiline,
    example: q.example,
    accept: q.accept,
    maxFiles: q.max_files,
    price: priceOf(q, f),
    shownIfChoiceId: q.shown_if_choice_id,
    versionIds: q.version_ids,
    choices: q.choices.map((c) => ({
      id: c.id,
      label: words.get(`question_choice:${c.id}:name`) ?? c.label,
      mainLabel: c.label,
      position: c.position,
      available: c.available,
      maxQuantity: c.max_quantity,
      photoAssetId: c.photo_asset_id,
      price: priceOf(c, f),
    })),
  }))
