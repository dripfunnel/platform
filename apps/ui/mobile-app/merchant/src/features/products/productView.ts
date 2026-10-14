import { productFilters, type ProductCounts, type ProductFilter, type ProductRow } from '../../api/products'
import { formatMoney } from '../../format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import type { Palette } from '../../theme/tokens'

// How a list row says what the API sent (CATALOG-DESIGN.md B1, CatList's phone cards): words and tones only. Prices, stock and
// readiness are the API's to work out; nothing here adds a figure that is charged or sold.

type ProductStatus = 'visible' | 'hidden' | 'pending' | 'sent_back'

export const statusOf = (row: Pick<ProductRow, 'approval' | 'visible'>): ProductStatus => (row.approval === 'pending' ? 'pending' : row.approval === 'sent_back' ? 'sent_back' : row.visible ? 'visible' : 'hidden')

export type Tone = 'success' | 'neutral' | 'warning' | 'danger'

export const statusTone: Record<ProductStatus, Tone> = { visible: 'success', hidden: 'neutral', pending: 'warning', sent_back: 'danger' }

/** A tone's colours from the theme: text, surface and border. */
export const toneColours = (colors: Palette, tone: Tone): { fg: string; bg: string; border: string } =>
  ({
    success: { fg: colors.success, bg: colors.successSurface, border: colors.successBorder },
    neutral: { fg: colors.neutral, bg: colors.neutralSurface, border: colors.neutralBorder },
    warning: { fg: colors.warning, bg: colors.warningSurface, border: colors.warningBorder },
    danger: { fg: colors.danger, bg: colors.dangerSurface, border: colors.dangerBorder },
  })[tone]

export const priceText = (row: Pick<ProductRow, 'minPrice' | 'maxPrice'>): string => {
  if (!row.minPrice) return t('products.row.noPrice')
  const low = formatMoney(row.minPrice, locale)
  const high = row.maxPrice ? formatMoney(row.maxPrice, locale) : low
  return low === high ? low : t('products.row.range', { low, high })
}

/** "12 in stock", "Out of stock", "Low: 3", or "Not tracked" for anything but a physical item (CATALOG-DESIGN.md B1). */
export const stockText = (row: Pick<ProductRow, 'productType' | 'stock' | 'lowStock'>): { text: string; tone: Tone } => {
  if (row.productType !== 'physical') return { text: t('products.row.notTracked'), tone: 'neutral' }
  if (row.stock === 0) return { text: t('products.row.outOfStock'), tone: 'danger' }
  if (row.lowStock) return { text: t('products.row.low', { count: row.stock }), tone: 'warning' }
  return { text: t('products.row.inStock', { count: row.stock }), tone: 'neutral' }
}

const kindKeys = { digital: 'products.row.download', service: 'products.row.service', gift_card: 'products.row.giftCard' } as const
const kindKeyOf = (type: string) => (type in kindKeys ? kindKeys[type as keyof typeof kindKeys] : null)

/** The muted line under the name: how many versions, or what kind of product, and a removed supplier's name. */
export const subText = (row: Pick<ProductRow, 'versionCount' | 'productType' | 'supplier' | 'supplierRemoved'>): string => {
  const kind = kindKeyOf(row.productType)
  const what = row.versionCount > 1 ? tCount('products.row.versions', row.versionCount) : kind ? t(kind) : t('products.row.noChoices')
  return row.supplierRemoved && row.supplier ? `${what}${t('products.row.removedSupplier', { supplier: row.supplier.name })}` : what
}

/** "Ready", "2 details missing" or "Ready in 1 of 3 markets"; null when the caller reads no market (a supplier). */
export const readyText = (row: Pick<ProductRow, 'readiness'>): { text: string; ready: boolean } | null => {
  const markets = row.readiness
  if (!markets || markets.length === 0) return null
  const ready = markets.filter((market) => market.ready).length
  if (markets.length === 1) {
    const [only] = markets
    return only?.ready ? { text: t('products.row.ready'), ready: true } : { text: tCount('products.row.missing', only?.missing.length ?? 0), ready: false }
  }
  return ready === markets.length ? { text: t('products.row.readyAll', { count: markets.length }), ready: true } : { text: t('products.row.someReady', { ready, count: markets.length }), ready: false }
}

/** The chips the list shows: always All, the others only with something in them (or while chosen). */
export const chipsOf = (counts: ProductCounts | null, active: ProductFilter): { key: ProductFilter; count: number | null }[] => {
  const count = (key: ProductFilter): number | null =>
    counts === null ? null : { all: counts.all, visible: counts.visible, hidden: counts.hidden, pending: counts.pending, sent_back: counts.sentBack, low_stock: counts.lowStock, missing_info: counts.missingInfo }[key]
  return productFilters.filter((key) => key === 'all' || key === active || counts === null || (count(key) ?? 0) > 0).map((key) => ({ key, count: count(key) }))
}
