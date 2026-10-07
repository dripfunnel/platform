import type { Money } from '#core/money'
import { priceInCurrency, priceInMarket, type StorePricing } from '#engine/modules/markets/index'
import type { ShopBadgeRow, ShopProductRow, ShopStockRow } from '#db/scoped/shop'

// What a shopper is told of a product, worked out on the server (PLATFORM-PROMPT §5.5: the storefront displays prices and
// stock, never asserts them): each version's price in the cart's currency and market, whether it can be bought, and badges.

export interface ShopVersionView {
  id: string
  name: string | null
  sku: string | null
  choices: { optionId: string; valueId: string }[]
  price: Money | null
  compareAt: Money | null
  /** What's left to sell; null when the store doesn't count this version's stock. */
  available: number | null
  inStock: boolean
  /** Sold on when none is left (CATALOG: "keep selling when out of stock"). */
  continueSelling: boolean
  weightGrams: number | null
}

export interface ShopProductView {
  id: string
  name: string
  slug: string
  description: string
  productType: string
  seoTitle: string | null
  seoDescription: string | null
  warranty: string | null
  returns: string | null
  sizeChartId: string | null
  /** The cheapest version's price ("from"), with its compare-at; null when no version is priced here. */
  price: Money | null
  compareAt: Money | null
  maxPrice: Money | null
  inStock: boolean
  photos: { assetId: string; alt: string | null; versionId: string | null }[]
  badges: { label: string; tone: string }[]
  versions: ShopVersionView[]
}

export interface ViewFacts {
  currency: string
  market: { currency: string; price_adjustment_bps: number }
  pricing: StorePricing
  stock: ReadonlyMap<string, ShopStockRow>
  /** Every badge the store defines; null when badges are off (Settings › Catalogue). */
  badges: readonly ShopBadgeRow[] | null
  now: Date
}

const newWithinMs = 30 * 86_400_000

export const productView = (row: ShopProductRow, f: ViewFacts): ShopProductView => {
  const versions = row.versions.map((v): ShopVersionView => {
    const typed = v.prices.map((p) => ({ currency: p.currency, amount: p.amount, compare_at_amount: p.compare_at_amount }))
    // The market's adjustment applies when the cart is in its currency; another currency is the store's own price in it.
    const price = f.market.currency === f.currency ? priceInMarket(typed, f.market, f.pricing) : priceInCurrency(typed, f.currency, f.pricing)
    const stock = f.stock.get(v.id)
    const available = v.track_stock ? (stock?.available ?? 0) : null
    return {
      id: v.id,
      name: v.name,
      sku: v.sku,
      choices: v.choices.map((c) => ({ optionId: c.option_id, valueId: c.value_id })),
      price: price.amount === null ? null : { amount: price.amount, currency: f.currency },
      compareAt: price.amount !== null && price.compareAt !== null && price.compareAt > price.amount ? { amount: price.compareAt, currency: f.currency } : null,
      available,
      inStock: !v.track_stock || v.continue_selling || (available ?? 0) > 0,
      continueSelling: v.continue_selling,
      weightGrams: v.weight_grams,
    }
  })
  const priced = versions.filter((v): v is ShopVersionView & { price: Money } => v.price !== null)
  const cheapest = priced.reduce<(typeof priced)[number] | null>((best, v) => (best === null || v.price.amount < best.price.amount ? v : best), null)
  const dearest = priced.reduce<(typeof priced)[number] | null>((best, v) => (best === null || v.price.amount > best.price.amount ? v : best), null)
  const low = row.versions.some((v) => v.track_stock && !v.continue_selling && f.stock.get(v.id)?.low === true && (f.stock.get(v.id)?.available ?? 0) > 0)
  // A badge is shown only when what it says is true: no rule is guessed (AGENTS.md "No invented data").
  const earned = (b: ShopBadgeRow) => {
    switch (b.rule) {
      case 'manual':
        return row.manual_badges.includes(b.id)
      case 'new_30_days':
        return f.now.getTime() - new Date(row.created_at).getTime() <= newWithinMs
      case 'below_compare_price':
        return versions.some((v) => v.compareAt !== null)
      case 'few_left':
        return low
      case 'top_5_this_month':
        // Needs a month of sales, which reports (SAPI 18) count.
        return false
    }
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    productType: row.product_type,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    warranty: row.warranty_text,
    returns: row.returns_text,
    sizeChartId: row.size_chart_id,
    price: cheapest?.price ?? null,
    compareAt: cheapest?.compareAt ?? null,
    maxPrice: dearest?.price ?? null,
    inStock: versions.some((v) => v.price !== null && v.inStock),
    photos: row.photos.map((p) => ({ assetId: p.asset_id, alt: p.alt, versionId: p.version_id })),
    badges: (f.badges ?? []).filter(earned).map((b) => ({ label: b.label, tone: b.tone })),
    versions,
  }
}
