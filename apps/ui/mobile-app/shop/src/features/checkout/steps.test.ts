import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import type { Cart } from '../../api/cart'
import { cartOperation } from '../../api/cart'
import { cartRead } from '../../testing/fixtures'
import { refusalCode, returnFor, sendBack, stepsFor } from './steps'

const cartOf = (over: Record<string, unknown> = {}): Cart => {
  const cart = cartOperation().parse({ cart: cartRead(over) })
  if (!cart) throw new Error('no cart')
  return cart
}

const notReady = (...problems: string[]) => new ApiError('NOT_READY', 'x', { problems })

describe('the steps of a cart', () => {
  it('have an address and delivery when something ships, and not when nothing does', () => {
    expect(stepsFor(cartOf())).toEqual(['contact', 'address', 'delivery', 'payment', 'review'])
    expect(stepsFor(cartOf({ needsShipping: false }))).toEqual(['contact', 'payment', 'review'])
  })
})

describe('where a refusal sends the shopper', () => {
  it.each([
    ['NO_CONTACT', 'contact'],
    ['NO_ADDRESS', 'address'],
    ['TAX_UNAVAILABLE', 'address'],
    ['NO_SHIPPING', 'delivery'],
    ['SHIPPING_UNAVAILABLE', 'delivery'],
    ['LINE_PROBLEM', 'cart'],
    ['EMPTY', 'cart'],
  ])('a not-ready cart with %s goes back to %s', (problem, step) => {
    expect(returnFor(notReady(problem))).toBe(step)
  })

  it('goes back to the earliest step of several problems', () => {
    expect(returnFor(notReady('NO_SHIPPING', 'NO_ADDRESS'))).toBe('address')
    expect(returnFor(notReady('NO_SHIPPING', 'LINE_PROBLEM'))).toBe('cart')
  })

  it.each([
    ['OUT_OF_STOCK', 'cart'],
    ['OFFER_CHANGED', 'cart'],
    ['CART_CHANGED', 'cart'],
    ['NO_CART', 'cart'],
    ['NOT_FOUND', 'cart'],
    ['METHOD_UNAVAILABLE', 'payment'],
    ['PHONE_REQUIRED', 'contact'],
  ])('%s goes back to %s', (code, step) => {
    expect(returnFor(new ApiError(code, 'x'))).toBe(step)
  })

  it('leaves anything no step can fix where it happened', () => {
    expect(returnFor(new ApiError('NO_RESPONSE', 'x'))).toBeNull()
    expect(returnFor(notReady('SOMETHING_NEW'))).toBeNull()
    expect(returnFor(new Error('x'))).toBeNull()
  })

  it('words a refused delivery by its own problem, and anything else by its code', () => {
    expect(refusalCode(notReady('SHIPPING_UNAVAILABLE'))).toBe('SHIPPING_UNAVAILABLE')
    expect(refusalCode(notReady('NO_CONTACT'))).toBe('NOT_READY')
    expect(refusalCode(new ApiError('OUT_OF_STOCK', 'x'))).toBe('OUT_OF_STOCK')
    expect(refusalCode(new Error('x'))).toBe('UNKNOWN')
  })

  it('is handled only when a step can fix it', () => {
    const seen: unknown[] = []
    const handle = sendBack((error) => seen.push(error))
    expect(handle(new ApiError('OUT_OF_STOCK', 'x'))).toBe(true)
    expect(handle(new ApiError('NO_RESPONSE', 'x'))).toBe(false)
    expect(seen).toHaveLength(1)
  })
})
