import AsyncStorage from '@react-native-async-storage/async-storage'
import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { fakeShop, hasText, isDisabled, press, pressableNamed, render, texts } from '../../testing/harness'
import { productAnswer, tee } from '../../testing/fixtures'
import { ProductScreen } from './ProductScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn(), navigate: jest.fn(), push: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
// The gallery needs the native video and gesture modules, which a test of the buying rules has no use for.
jest.mock('./Gallery', () => ({ Gallery: () => null }))

const sells = (over: Record<string, unknown> = {}, pricesIncludeTax = true) => fakeShop(({ query }) => (query.includes('addToCart') ? { addToCart: { cartToken: 'cart-1' } } : productAnswer(tee(over), pricesIncludeTax)))

beforeEach(() => AsyncStorage.clear())

describe('the product page', () => {
  it("shows the price with the API's tax label, and the stock sentence once a version is chosen", async () => {
    const screen = await render(<ProductScreen slug="tee-p1" />, sells())
    expect(hasText(screen, t('product.from', { price: '₹1,499.00' }))).toBe(true)
    expect(hasText(screen, t('product.tax.included'))).toBe(true)
    expect(hasText(screen, t('product.stock.choose', { options: 'colour and size' }))).toBe(true)

    await press(screen, 'Black')
    await press(screen, 'L')
    expect(hasText(screen, '₹1,699.00')).toBe(true)
    expect(hasText(screen, '₹1,999.00')).toBe(true)
    expect(hasText(screen, t('product.stock.low', { count: 2 }))).toBe(true)
  })

  it('words the tax by what the store says: prices excluding tax read "tax calculated at checkout"', async () => {
    const screen = await render(<ProductScreen slug="tee-p1" />, sells({}, false))
    expect(hasText(screen, t('product.tax.added'))).toBe(true)
    expect(hasText(screen, t('product.tax.included'))).toBe(false)
  })

  it('disables a value no version has with what is already chosen, and marks a sold-out one', async () => {
    const screen = await render(<ProductScreen slug="tee-p1" />, sells())
    await press(screen, 'M')
    expect(isDisabled(pressableNamed(screen, t('product.valueUnavailable', { value: 'Black' })))).toBe(true)
    await press(screen, 'M')
    await press(screen, 'Sand')
    expect(isDisabled(pressableNamed(screen, t('product.valueSoldOut', { value: 'L' })))).toBe(false)
  })

  it('cannot add until every option is chosen, and says which to choose', async () => {
    const screen = await render(<ProductScreen slug="tee-p1" />, sells())
    expect(isDisabled(pressableNamed(screen, t('product.chooseOption', { option: 'colour' })))).toBe(true)
    await press(screen, 'Sand')
    expect(isDisabled(pressableNamed(screen, t('product.chooseOption', { option: 'size' })))).toBe(true)
  })

  it('cannot add a sold-out version, and says so', async () => {
    const screen = await render(<ProductScreen slug="tee-p1" />, sells())
    await press(screen, 'Sand')
    await press(screen, t('product.valueSoldOut', { value: 'L' }))
    expect(hasText(screen, t('product.stock.versionSoldOut'))).toBe(true)
    expect(isDisabled(pressableNamed(screen, t('product.stock.soldOut')))).toBe(true)
  })

  it('adds the chosen version and quantity, keeps the guest cart token, and offers the cart', async () => {
    const shop = sells()
    const screen = await render(<ProductScreen slug="tee-p1" />, shop)
    await press(screen, 'Sand')
    await press(screen, 'M')
    await press(screen, t('product.quantityMore'))
    await press(screen, t('product.addToCart'))

    const add = shop.requests.find((request) => request.query.includes('addToCart'))
    expect(add?.variables).toEqual({ versionId: 'ver-sand-m', quantity: 2 })
    expect(shop.cartTokens).toEqual(['cart-1'])
    expect(hasText(screen, t('product.added'))).toBe(true)
    expect(texts(screen)).toContain(t('product.viewCart'))
  })

  it('words a refusal by its code, and adds nothing to the display', async () => {
    const shop = fakeShop(({ query }) => {
      if (query.includes('addToCart')) throw new ApiError('UNAVAILABLE', 'That isn’t available any more.')
      return productAnswer(tee())
    })
    const screen = await render(<ProductScreen slug="tee-p1" />, shop)
    await press(screen, 'Sand')
    await press(screen, 'M')
    await press(screen, t('product.addToCart'))
    expect(hasText(screen, t('errors.UNAVAILABLE'))).toBe(true)
    expect(hasText(screen, t('product.added'))).toBe(false)
    expect(shop.cartTokens).toEqual([])
  })

  it('shows a product that is not there, a load error with a retry, and an offline state with nothing kept', async () => {
    const gone = await render(<ProductScreen slug="gone" />, fakeShop(() => productAnswer(null)))
    expect(hasText(gone, t('product.notFound.title'))).toBe(true)

    let fail: ApiError | null = new ApiError('RATE_LIMITED', 'x')
    const broken = await render(
      <ProductScreen slug="tee-p1" />,
      fakeShop(() => {
        if (fail) throw fail
        return productAnswer(tee())
      }),
    )
    expect(hasText(broken, t('errors.RATE_LIMITED'))).toBe(true)
    fail = null
    await press(broken, t('states.retry'))
    expect(hasText(broken, 'Linen Tee')).toBe(true)

    const offline = await render(<ProductScreen slug="never-seen" />, fakeShop(() => { throw new ApiError('NO_RESPONSE', 'x') }))
    expect(hasText(offline, t('states.offline.title'))).toBe(true)
  })

  it('shows the last page it loaded with a banner when there is no connection, and will not add to the cart', async () => {
    const first = await render(<ProductScreen slug="tee-p1" />, sells())
    expect(hasText(first, t('states.offline.banner'))).toBe(false)

    const offline = await render(<ProductScreen slug="tee-p1" />, fakeShop(() => { throw new ApiError('NO_RESPONSE', 'x') }))
    expect(hasText(offline, t('states.offline.banner'))).toBe(true)
    expect(hasText(offline, 'Linen Tee')).toBe(true)
    await press(offline, 'Sand')
    await press(offline, 'M')
    expect(isDisabled(pressableNamed(offline, t('product.offlineAdd')))).toBe(true)
  })
})
