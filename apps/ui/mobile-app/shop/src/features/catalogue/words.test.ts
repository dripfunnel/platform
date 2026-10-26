import { t } from '../../messages'
import { inr } from '../../testing/fixtures'
import { errorKey } from '../common/errors'
import { lowStockAt, money, stockLine, taxLine } from './words'

const version = (over: Partial<{ inStock: boolean; available: number | null }> = {}) => ({ id: 'v', name: null, inStock: true, available: 20, price: inr('100'), compareAt: null, choices: {}, ...over })
const colour = { id: 'o', name: 'Colour', values: [] }

describe('the words for what the API says', () => {
  it('formats money from the API’s minor units and currency', () => {
    expect(money(inr('149900'))).toBe('₹1,499.00')
    expect(money({ amount: '1999', currency: 'USD' })).toBe('$19.99')
  })

  it('words the tax by whether prices include it', () => {
    expect(taxLine(true)).toBe(t('product.tax.included'))
    expect(taxLine(false)).toBe(t('product.tax.added'))
  })

  it('words stock: sold out, choose first, this version sold out, only a few left, in stock', () => {
    expect(stockLine({ inStock: false }, version(), [])).toEqual({ text: t('product.stock.soldOut'), tone: 'out' })
    expect(stockLine({ inStock: true }, null, [colour])).toEqual({ text: t('product.stock.choose', { options: 'colour' }), tone: 'neutral' })
    expect(stockLine({ inStock: true }, version({ inStock: false, available: 0 }), [])).toEqual({ text: t('product.stock.versionSoldOut'), tone: 'out' })
    expect(stockLine({ inStock: true }, version({ available: lowStockAt }), [])).toEqual({ text: t('product.stock.low', { count: lowStockAt }), tone: 'low' })
    expect(stockLine({ inStock: true }, version({ available: lowStockAt + 1 }), [])).toEqual({ text: t('product.stock.in'), tone: 'good' })
  })

  it('says "in stock", never a count, when the store does not count stock', () => {
    expect(stockLine({ inStock: true }, version({ available: null }), [])).toEqual({ text: t('product.stock.in'), tone: 'good' })
  })

  it('words an error by its code, with one line for a code it has no words for', () => {
    expect(errorKey('NO_RESPONSE')).toBe('errors.NO_RESPONSE')
    expect(errorKey('UNAVAILABLE')).toBe('errors.UNAVAILABLE')
    expect(errorKey('STORE_UNAVAILABLE')).toBe('errors.STORE_UNAVAILABLE')
    expect(errorKey('TOO_MANY_LINES')).toBe('errors.TOO_MANY_LINES')
    expect(errorKey('SOMETHING_NEW')).toBe('errors.UNKNOWN')
  })
})
