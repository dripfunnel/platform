import { formatMoney } from '@dripfunnel/shared/format'
import type { ProductCounts, ProductRow } from '../../api/products'
import { fill, formatCount, locale, messages, plural } from '../../messages'

// How CatList words a row (FIRST-RELEASE §11): its status, price, stock, versions and readiness. The API decides
// every number; these only say them.

const words = messages.products

export type RowStatus = 'visible' | 'hidden' | 'pending' | 'sent_back'

/** Waiting for approval and Sent back win over visibility, as the prototype's pills do. */
export const statusOf = (row: ProductRow): RowStatus => (row.approval === 'pending' ? 'pending' : row.approval === 'sent_back' ? 'sent_back' : row.visible ? 'visible' : 'hidden')

const money = (amount: string, currency: string) => formatMoney({ amount: Number(amount), currency }, locale)

/** "₹2,499.00 – ₹2,799.00" for versions that differ, one price when they don't, and "No price" for none. */
export const priceText = (row: ProductRow): string => {
  if (!row.minPrice) return words.row.noPrice
  const low = money(row.minPrice.amount, row.minPrice.currency)
  return row.maxPrice && row.maxPrice.amount !== row.minPrice.amount ? `${low} – ${money(row.maxPrice.amount, row.maxPrice.currency)}` : low
}

export type StockTone = 'out' | 'low' | 'normal'

/** Only physical products count stock (CATALOG T14); five and under is low, as the store's default threshold. */
export const stockOf = (row: ProductRow): { text: string; tone: StockTone } => {
  if (row.productType !== 'physical') return { text: words.row.notTracked, tone: 'normal' }
  if (row.stock <= 0) return { text: words.row.outOfStock, tone: 'out' }
  if (row.stock <= 5) return { text: fill(words.row.low, { count: formatCount(row.stock) }), tone: 'low' }
  return { text: fill(words.row.inStock, { count: formatCount(row.stock) }), tone: 'normal' }
}

/** Under the name: its versions or what it is, and a removed supplier's mark (#183). */
export const subOf = (row: ProductRow): string => {
  const kind =
    row.productType === 'digital'
      ? words.row.download
      : row.productType === 'service'
        ? words.row.service
        : row.productType === 'gift_card'
          ? words.row.giftCard
          : row.versionCount > 1
            ? fill(plural(words.row.versions, row.versionCount), { count: formatCount(row.versionCount) })
            : words.row.noChoices
  return row.supplier && row.supplierRemoved ? kind + fill(words.row.removedSupplier, { supplier: row.supplier.name }) : kind
}

/** "Ready", "2 details missing" with one market; "Ready in all 3" or "1 of 3 markets" with more. */
export const readyOf = (row: ProductRow): { text: string; ready: boolean } | null => {
  const markets = row.readiness
  if (!markets || markets.length === 0) return null
  const ready = markets.filter((m) => m.ready).length
  const only = markets.length === 1 ? markets[0] : undefined
  if (only) return only.ready ? { text: words.row.ready, ready: true } : { text: fill(plural(words.row.missing, only.missing.length), { count: formatCount(only.missing.length) }), ready: false }
  return ready === markets.length ? { text: fill(words.row.readyAll, { count: formatCount(markets.length) }), ready: true } : { text: fill(words.row.someReady, { ready: formatCount(ready), count: formatCount(markets.length) }), ready: false }
}

/** The line under the title: how many, from suppliers, out of stock; a supplier's own count and its approval work. */
export const summaryOf = (counts: ProductCounts, rows: readonly ProductRow[], supplier: boolean): string => {
  const products = fill(plural(words.summary.products, counts.all), { count: formatCount(counts.all) })
  if (supplier) return fill(words.summary.supplier, { products, waiting: formatCount(counts.pending), sentBack: formatCount(counts.sentBack) })
  const fromSuppliers = rows.filter((r) => r.supplier).length
  const outOfStock = rows.filter((r) => r.productType === 'physical' && r.stock <= 0).length
  return fill(words.summary.merchant, {
    products,
    fromSuppliers: fromSuppliers > 0 ? fill(words.summary.fromSuppliers, { count: formatCount(fromSuppliers) }) : '',
    outOfStock: fill(words.summary.outOfStock, { count: formatCount(outOfStock) }),
  })
}

/** What a review lists: photo, price, then each market's readiness in words. */
export const reviewChecks = (row: ProductRow): { ok: boolean; label: string }[] => [
  { ok: row.photoUrl !== null, label: row.photoUrl ? words.review.photos : words.review.noPhoto },
  { ok: row.minPrice !== null, label: row.minPrice ? words.review.priced : words.review.noPrice },
  ...(row.readiness ?? []).map((m) =>
    m.ready
      ? { ok: true, label: fill(words.review.readyIn, { market: m.marketName }) }
      : { ok: false, label: fill(words.review.notReadyIn, { market: m.marketName, missing: m.missing.map((n) => (words.needs as Record<string, string>)[n] ?? n).join(', ') }) },
  ),
]

export interface ProductAccess {
  supplier: boolean
  /** Adds and edits: catalog.write for the merchant, catalog.propose for a supplier. */
  canEdit: boolean
  /** Bulk changes, which only the merchant makes. */
  canSelect: boolean
  canApprove: boolean
  seeSuppliers: boolean
  viewOnly: boolean
}

/** What the acting seat may do here (ACCESS.md §5); a read-only store (past due) does nothing but look. */
export const accessOf = (acting: { permissions: readonly string[]; seller: unknown }, readOnly: boolean): ProductAccess => {
  const has = (p: string) => acting.permissions.includes(p)
  const supplier = acting.seller !== null
  const canEdit = !readOnly && (supplier ? has('catalog.propose') : has('catalog.write'))
  return {
    supplier,
    canEdit,
    canSelect: canEdit && !supplier,
    canApprove: !readOnly && !supplier && has('approve'),
    seeSuppliers: !supplier && has('manage-vendors'),
    viewOnly: !supplier && !has('catalog.write'),
  }
}
