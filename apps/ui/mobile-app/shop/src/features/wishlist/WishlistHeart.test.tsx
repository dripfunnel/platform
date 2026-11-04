import AsyncStorage from '@react-native-async-storage/async-storage'
import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { takePendingWishlist } from '../../session/pendingWishlist'
import { fakeShop, hasText, isDisabled, press, pressableNamed, render } from '../../testing/harness'
import { productAnswer, tee } from '../../testing/fixtures'
import { ProductScreen } from '../catalogue/ProductScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn(), navigate: jest.fn(), push: mockPush }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('../catalogue/Gallery', () => ({ Gallery: () => null }))

const heart = t('wishlist.heart', { name: 'Linen Tee' })
const checked = (screen: Parameters<typeof pressableNamed>[0]) => pressableNamed(screen, heart).props.accessibilityState.checked

/** The shop's answers: the product, the wishlist's ids, and the two writes (each recorded by `requests`). */
const shop = (ids: string[], { signedIn = true, refuse }: { signedIn?: boolean; refuse?: string } = {}) =>
  fakeShop(
    ({ query }) => {
      if (query.includes('addToWishlist') || query.includes('removeFromWishlist')) {
        if (refuse) throw new ApiError(refuse, 'refused')
        return { ok: true }
      }
      if (query.includes('wishlist')) return { wishlist: ids.map((id) => ({ id })) }
      return productAnswer(tee())
    },
    { signedIn },
  )

const writes = (s: ReturnType<typeof shop>) => s.requests.filter((r) => r.query.includes('ToWishlist') || r.query.includes('FromWishlist')).map((r) => [r.query.includes('addToWishlist') ? 'add' : 'remove', r.variables])

beforeEach(async () => {
  mockPush.mockClear()
  await AsyncStorage.clear()
})

describe('the heart beside Add to cart', () => {
  it('is an unpressed toggle named for the product when the product is not on the wishlist', async () => {
    const screen = await render(<ProductScreen slug="tee-p1" />, shop([]))
    expect(pressableNamed(screen, heart).props.accessibilityRole).toBe('togglebutton')
    expect(checked(screen)).toBe(false)
  })

  it('adds the product, then removes it on the next press', async () => {
    const s = shop([])
    const screen = await render(<ProductScreen slug="tee-p1" />, s)
    await press(screen, heart)
    expect(checked(screen)).toBe(true)
    await press(screen, heart)
    expect(checked(screen)).toBe(false)
    expect(writes(s)).toEqual([['add', { productId: 'p1' }], ['remove', { productId: 'p1' }]])
  })

  it('shows as pressed when the product is already on the wishlist', async () => {
    const screen = await render(<ProductScreen slug="tee-p1" />, shop(['p9', 'p1']))
    expect(checked(screen)).toBe(true)
  })

  it('words a refusal by its code and leaves the heart as it was', async () => {
    const screen = await render(<ProductScreen slug="tee-p1" />, shop([], { refuse: 'LIMIT' }))
    await press(screen, heart)
    expect(hasText(screen, t('errors.LIMIT'))).toBe(true)
    expect(checked(screen)).toBe(false)
  })

  it('is off while the wishlist is still loading, so a press cannot undo what it has not read', async () => {
    const never = fakeShop(({ query }) => (query.includes('wishlist') ? new Promise(() => undefined) : productAnswer(tee())), { signedIn: true })
    const screen = await render(<ProductScreen slug="tee-p1" />, never)
    expect(isDisabled(pressableNamed(screen, heart))).toBe(true)
  })

  it('sends a signed-out shopper to sign in, asks the API for nothing, and keeps the product for after', async () => {
    const s = shop([], { signedIn: false })
    const screen = await render(<ProductScreen slug="tee-p1" />, s)
    await press(screen, heart)
    expect(mockPush).toHaveBeenLastCalledWith('/sign-in')
    expect(writes(s)).toEqual([])
    expect(s.requests.some((r) => r.query.includes('wishlist'))).toBe(false)
    expect(await takePendingWishlist(s.host)).toBe('p1')
  })
})
