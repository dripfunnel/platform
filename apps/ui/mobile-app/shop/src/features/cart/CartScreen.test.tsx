import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { cartLine, cartRead, inr } from '../../testing/fixtures'
import { fakeShop, fill, hasText, isDisabled, press, pressableNamed, render } from '../../testing/harness'
import { CartScreen } from './CartScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const mockPush = jest.fn()
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return { useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }), useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) }
})
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

beforeEach(() => mockPush.mockClear())

const name = 'Tee 1'

describe('the cart', () => {
  it("shows the totals exactly as the API priced them, never added up by the app", async () => {
    // The lines add up to ₹2,998.00 and the engine says ₹2,000.00: its figures are shown as sent, and no sum of the app's own appears.
    const cart = cartRead({ lines: [cartLine('1', { quantity: 2, lineTotal: inr('299800') })], subtotal: inr('200000'), discounts: [{ code: null, name: 'Festival offer', amount: inr('10000') }], total: inr('195500'), tax: { amount: inr('9310'), pricesIncludeTax: true } })
    const screen = await render(<CartScreen />, fakeShop(() => ({ cart })))
    expect(hasText(screen, '₹2,000.00')).toBe(true)
    expect(hasText(screen, 'Festival offer')).toBe(true)
    expect(hasText(screen, '−₹100.00')).toBe(true)
    expect(hasText(screen, '₹1,955.00')).toBe(true)
    expect(hasText(screen, t('cart.totals.includes', { amount: '₹93.10' }))).toBe(true)
    expect(hasText(screen, '₹2,898.00')).toBe(false)
    expect(hasText(screen, t('cart.totals.later'))).toBe(true)
  })

  it('changes a quantity through the API and shows the cart it answers', async () => {
    const answered = cartRead({ lines: [cartLine('1', { quantity: 2, lineTotal: inr('299800') })], subtotal: inr('299800'), total: inr('299800') })
    const shop = fakeShop(({ query }) => (query.includes('setCartQuantity') ? { setCartQuantity: { cart: answered, cartToken: null } } : { cart: cartRead() }))
    const screen = await render(<CartScreen />, shop)
    await press(screen, t('cart.more', { name }))
    expect(shop.requests.find((r) => r.query.includes('setCartQuantity'))?.variables).toEqual({ versionId: 'ver-1', quantity: 2 })
    expect(hasText(screen, '₹2,998.00')).toBe(true)
  })

  it('takes a line out with a quantity of 0', async () => {
    const shop = fakeShop(({ query }) => (query.includes('setCartQuantity') ? { setCartQuantity: { cart: null, cartToken: null } } : { cart: cartRead() }))
    const screen = await render(<CartScreen />, shop)
    await press(screen, t('cart.remove', { name }))
    expect(shop.requests.find((r) => r.query.includes('setCartQuantity'))?.variables).toEqual({ versionId: 'ver-1', quantity: 0 })
    expect(hasText(screen, t('cart.empty.title'))).toBe(true)
  })

  it('words an offer code by the state the API gives, and keeps a refused one off the cart', async () => {
    const shop = fakeShop(({ query }) => (query.includes('applyCode') ? { applyCode: { state: 'EXPIRED', cart: cartRead() } } : { cart: cartRead() }))
    const screen = await render(<CartScreen />, shop)
    await fill(screen, t('cart.code.label'), 'OLD10')
    await press(screen, t('cart.code.apply'))
    expect(shop.requests.find((r) => r.query.includes('applyCode'))?.variables).toEqual({ code: 'OLD10' })
    expect(hasText(screen, t('cart.code.EXPIRED', { code: 'OLD10' }))).toBe(true)
  })

  it('shows an applied code with its discount and lets it be taken off', async () => {
    const withCode = cartRead({ codes: [{ code: 'SAVE10', state: 'APPLIED' }], discounts: [{ code: 'SAVE10', name: 'SAVE10', amount: inr('14990') }] })
    const shop = fakeShop(({ query }) => (query.includes('removeCode') ? { removeCode: { cart: cartRead(), cartToken: null } } : { cart: withCode }))
    const screen = await render(<CartScreen />, shop)
    expect(hasText(screen, '−₹149.90')).toBe(true)
    await press(screen, t('cart.code.remove', { code: 'SAVE10' }))
    expect(shop.requests.find((r) => r.query.includes('removeCode'))?.variables).toEqual({ code: 'SAVE10' })
    expect(hasText(screen, '−₹149.90')).toBe(false)
  })

  it('says why a line cannot be bought and will not go to checkout until it is fixed', async () => {
    const cart = cartRead({ lines: [cartLine('1', { quantity: 3, available: 1, problem: 'short' }), cartLine('2', { problem: 'unavailable' })] })
    const screen = await render(<CartScreen />, fakeShop(() => ({ cart })))
    expect(hasText(screen, t('cart.problem.short', { count: 1 }))).toBe(true)
    expect(hasText(screen, t('cart.problem.unavailable'))).toBe(true)
    expect(isDisabled(pressableNamed(screen, t('cart.checkout', { total: '₹1,499.00' })))).toBe(true)
  })

  it('goes to checkout when every line can be bought', async () => {
    const screen = await render(<CartScreen />, fakeShop(() => ({ cart: cartRead() })))
    await press(screen, t('cart.checkout', { total: '₹1,499.00' }))
    expect(mockPush).toHaveBeenCalledWith('/checkout')
  })

  it('says a refusal by its code, and keeps the cart on screen', async () => {
    const shop = fakeShop(({ query }) => {
      if (query.includes('setCartQuantity')) throw new ApiError('INVALID_INPUT', 'x')
      return { cart: cartRead() }
    })
    const screen = await render(<CartScreen />, shop)
    await press(screen, t('cart.more', { name }))
    expect(hasText(screen, t('errors.INVALID_INPUT'))).toBe(true)
    expect(hasText(screen, name)).toBe(true)
  })

  it('has its empty, offline and error states', async () => {
    expect(hasText(await render(<CartScreen />, fakeShop(() => ({ cart: null }))), t('cart.empty.title'))).toBe(true)
    const offline = await render(<CartScreen />, fakeShop(() => { throw new ApiError('NO_RESPONSE', 'x') }))
    expect(hasText(offline, t('states.offline.title'))).toBe(true)
    const broken = await render(<CartScreen />, fakeShop(() => { throw new ApiError('UNAVAILABLE', 'x') }))
    expect(hasText(broken, t('states.error.title'))).toBe(true)
  })

  it('keeps a guest’s new cart token', async () => {
    const shop = fakeShop(({ query }) => (query.includes('setCartQuantity') ? { setCartQuantity: { cart: cartRead(), cartToken: 'cart-new' } } : { cart: cartRead() }))
    const screen = await render(<CartScreen />, shop)
    await press(screen, t('cart.more', { name }))
    expect(shop.cartTokens).toEqual(['cart-new'])
  })
})
