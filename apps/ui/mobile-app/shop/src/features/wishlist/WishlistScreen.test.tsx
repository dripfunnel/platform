import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { fakeShop, hasText, isDisabled, press, pressableNamed, render } from '../../testing/harness'
import { productAnswer, summary, tee } from '../../testing/fixtures'
import { WishlistScreen } from './WishlistScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
const mockPush = jest.fn()
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const single = tee({ options: [], versions: [{ id: 'ver-only', name: null, inStock: true, available: 5, price: { amount: '149900', currency: 'INR' }, compareAt: null, choices: [] }] })

const shop = (items: unknown[], over: (query: string) => unknown = () => undefined, signedIn = true) =>
  fakeShop(
    ({ query }) => {
      const special = over(query)
      if (special !== undefined) return special
      if (query.includes('addToCart')) return { addToCart: { cartToken: 'cart-1' } }
      if (query.includes('removeFromWishlist')) return { removeFromWishlist: true }
      if (query.includes('wishlist')) return { wishlist: items }
      return productAnswer(single)
    },
    { signedIn },
  )

beforeEach(() => mockPush.mockClear())

describe('the Wishlist screen', () => {
  it('lists each product with its price, and opens one', async () => {
    const screen = await render(<WishlistScreen />, shop([summary('p1'), summary('p2', { name: 'Sold Tee', inStock: false })]))
    expect(hasText(screen, 'Tee p1')).toBe(true)
    expect(hasText(screen, '₹1,499.00')).toBe(true)
    expect(hasText(screen, t('product.stock.soldOut'))).toBe(true)
    await press(screen, 'Tee p1, ₹1,499.00')
    expect(mockPush).toHaveBeenLastCalledWith('/product/tee-p1')
  })

  it('says so when the wishlist is empty', async () => {
    const screen = await render(<WishlistScreen />, shop([]))
    expect(hasText(screen, t('wishlist.empty.title'))).toBe(true)
  })

  it('shows a loading state, then an error with a way to try again', async () => {
    let fail = true
    const s = shop([summary('p1')], (query) => {
      if (query.includes('wishlist') && fail) throw new ApiError('UNAVAILABLE', 'down')
      return undefined
    })
    const screen = await render(<WishlistScreen />, s)
    expect(hasText(screen, t('states.error.title'))).toBe(true)
    fail = false
    await press(screen, t('states.retry'))
    expect(hasText(screen, 'Tee p1')).toBe(true)
  })

  it('shows the loading skeleton while the list is on its way', async () => {
    const screen = await render(<WishlistScreen />, shop([], (query) => (query.includes('wishlist') ? new Promise(() => undefined) : undefined)))
    expect(screen.root.findAll((node) => node.props.accessibilityLabel === t('states.loading')).length).toBeGreaterThan(0)
  })

  it('asks a signed-out shopper to sign in, and asks the API for nothing', async () => {
    const s = shop([], undefined, false)
    const screen = await render(<WishlistScreen />, s)
    expect(hasText(screen, t('wishlist.signedOut.title'))).toBe(true)
    expect(s.requests).toHaveLength(0)
    await press(screen, t('auth.signInButton'))
    expect(mockPush).toHaveBeenLastCalledWith('/sign-in')
  })

  it('removes a product from the wishlist and from the list', async () => {
    const s = shop([summary('p1'), summary('p2')])
    const screen = await render(<WishlistScreen />, s)
    await press(screen, t('wishlist.remove'))
    expect(s.requests.find((r) => r.query.includes('removeFromWishlist'))?.variables).toEqual({ productId: 'p1' })
    expect(hasText(screen, 'Tee p1')).toBe(false)
    expect(hasText(screen, 'Tee p2')).toBe(true)
  })

  it('adds a product with one version to the cart and keeps the guest cart token', async () => {
    const s = shop([summary('p1')])
    const screen = await render(<WishlistScreen />, s)
    await press(screen, t('wishlist.addToCart'))
    expect(s.requests.find((r) => r.query.includes('addToCart'))?.variables).toEqual({ versionId: 'ver-only', quantity: 1 })
    expect(s.cartTokens).toEqual(['cart-1'])
    expect(hasText(screen, t('wishlist.added'))).toBe(true)
  })

  it('opens a product that needs a choice, instead of guessing one', async () => {
    const s = shop([summary('p1')], (query) => (query.includes('product(slug') ? productAnswer(tee()) : undefined))
    const screen = await render(<WishlistScreen />, s)
    await press(screen, t('wishlist.addToCart'))
    expect(s.requests.some((r) => r.query.includes('addToCart'))).toBe(false)
    expect(mockPush).toHaveBeenLastCalledWith('/product/tee-p1')
  })

  it('cannot add a sold-out product, and words a refusal by its code', async () => {
    const soldOut = await render(<WishlistScreen />, shop([summary('p1', { inStock: false })]))
    expect(isDisabled(pressableNamed(soldOut, t('wishlist.addToCart')))).toBe(true)
    const refusing = shop([summary('p1')], (query) => {
      if (query.includes('addToCart')) throw new ApiError('UNAVAILABLE', 'gone')
      return undefined
    })
    const screen = await render(<WishlistScreen />, refusing)
    await press(screen, t('wishlist.addToCart'))
    expect(hasText(screen, t('errors.UNAVAILABLE'))).toBe(true)
    expect(hasText(screen, t('wishlist.added'))).toBe(false)
  })
})
