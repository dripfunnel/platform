import AsyncStorage from '@react-native-async-storage/async-storage'
import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { fakeShop, hasText, press, render } from '../../testing/harness'
import { page, summary } from '../../testing/fixtures'
import { HomeScreen } from './HomeScreen'

jest.setTimeout(120_000)

const mockPush = jest.fn()
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const shelf = {
  collections: page([{ id: 'c1', slug: 'summer', name: 'Summer', description: null, image: null }]),
  products: page([summary('a', { name: 'Linen Tee' }), summary('b', { name: 'Sold Tee', inStock: false })]),
}

beforeEach(() => {
  mockPush.mockClear()
  return AsyncStorage.clear()
})

describe('Home', () => {
  it("shows the store's collections and newest products with the search entry, and opens them", async () => {
    const screen = await render(<HomeScreen />, fakeShop(() => shelf))
    expect(hasText(screen, t('home.collections'))).toBe(true)
    expect(hasText(screen, 'Summer')).toBe(true)
    expect(hasText(screen, 'Linen Tee')).toBe(true)
    expect(hasText(screen, '₹1,499.00')).toBe(true)

    await press(screen, 'Summer')
    expect(mockPush).toHaveBeenLastCalledWith('/browse/collection/summer')
    await press(screen, t('home.search'))
    expect(mockPush).toHaveBeenLastCalledWith('/browse/search')
    await press(screen, t('home.seeAllNewIn'))
    expect(mockPush).toHaveBeenLastCalledWith('/browse/all')
  })

  it('marks what is sold out, as the API says', async () => {
    const screen = await render(<HomeScreen />, fakeShop(() => shelf))
    expect(hasText(screen, t('product.stock.soldOut'))).toBe(true)
  })

  it('has an empty state for a shop with nothing in it', async () => {
    const screen = await render(<HomeScreen />, fakeShop(() => ({ collections: page([]), products: page([]) })))
    expect(hasText(screen, t('home.empty.title'))).toBe(true)
  })

  it('shows a load error by its code, and loads again on retry', async () => {
    let fail = true
    const screen = await render(
      <HomeScreen />,
      fakeShop(() => {
        if (fail) throw new ApiError('RATE_LIMITED', 'x')
        return shelf
      }),
    )
    expect(hasText(screen, t('errors.RATE_LIMITED'))).toBe(true)
    fail = false
    await press(screen, t('states.retry'))
    expect(hasText(screen, 'Linen Tee')).toBe(true)
  })

  it('shows the last page it loaded under an offline banner when there is no connection', async () => {
    await render(<HomeScreen />, fakeShop(() => shelf))
    const offline = await render(<HomeScreen />, fakeShop(() => { throw new ApiError('NO_RESPONSE', 'x') }))
    expect(hasText(offline, t('states.offline.banner'))).toBe(true)
    expect(hasText(offline, 'Linen Tee')).toBe(true)
  })

  it('shows an offline state, not a blank screen, when there is no connection and nothing was loaded before', async () => {
    const offline = await render(<HomeScreen />, fakeShop(() => { throw new ApiError('NO_RESPONSE', 'x') }))
    expect(hasText(offline, t('states.offline.title'))).toBe(true)
    expect(hasText(offline, t('states.offline.banner'))).toBe(false)
  })
})
