import { formatList, formatMoney, formatNumber } from '@dripfunnel/mobile-shared/format'
import type { Price, ProductOption, ProductVersion } from '../../api/catalogue'
import { locale, t, type MessageKey } from '../../messages'

export const money = (price: Price): string => formatMoney(price, locale)

/** The API serves whether prices include tax, not a sentence: the sentence is the app's, chosen by that value. */
export const taxLine = (pricesIncludeTax: boolean): string => t(pricesIncludeTax ? 'product.tax.included' : 'product.tax.added')

/** Stock at which "Only N left" replaces "In stock". */
export const lowStockAt = 3

export type StockLine = { text: string; tone: 'good' | 'low' | 'out' | 'neutral' }

/** The stock sentence for what the shopper has chosen: from the API's `inStock` and `available`, never a count of the app's own. */
export const stockLine = (product: { inStock: boolean }, version: ProductVersion | null, missing: ProductOption[]): StockLine => {
  if (!product.inStock) return { text: t('product.stock.soldOut'), tone: 'out' }
  if (!version) return { text: t('product.stock.choose', { options: formatList(missing.map((option) => option.name.toLowerCase()), locale) }), tone: 'neutral' }
  if (!version.inStock) return { text: t('product.stock.versionSoldOut'), tone: 'out' }
  if (version.available !== null && version.available <= lowStockAt) return { text: t('product.stock.low', { count: formatNumber(version.available, locale) }), tone: 'low' }
  return { text: t('product.stock.in'), tone: 'good' }
}

/** A refusal's words by its code (errors are worded by code, never by the API's English). */
export const errorKey = (code: string): MessageKey => {
  switch (code) {
    case 'NO_RESPONSE':
      return 'errors.NO_RESPONSE'
    case 'UNAVAILABLE':
      return 'errors.UNAVAILABLE'
    case 'RATE_LIMITED':
      return 'errors.RATE_LIMITED'
    case 'INVALID_INPUT':
      return 'errors.INVALID_INPUT'
    default:
      return 'errors.UNKNOWN'
  }
}
