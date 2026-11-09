import AsyncStorage from '@react-native-async-storage/async-storage'
import { act } from 'react-test-renderer'
import { t } from '../../messages'
import { fakeShop, fill, hasText, press, render } from '../../testing/harness'
import { cartLine, productAnswer, tee } from '../../testing/fixtures'
import { CartScreen } from '../cart/CartScreen'
import { ProductScreen } from './ProductScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn(), navigate: jest.fn(), push: jest.fn() }), useFocusEffect: () => undefined }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('./Gallery', () => ({ Gallery: () => null }))
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: jest.fn(), requestMediaLibraryPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))

beforeEach(() => AsyncStorage.clear())

const inr = (amount: string) => ({ amount, currency: 'INR' })
const questions = [
  { id: 'q-wrap', kind: 'CHOICE', label: 'Gift wrap', help: null, required: false, minPicks: 0, maxPicks: 1, freePicks: 0, maxLength: null, multiline: null, example: null, accept: null, maxFiles: null, versionIds: null, shownIf: null, price: null, choices: [{ id: 'c-yes', label: 'Yes', available: true, maxQuantity: 1, photo: null, price: { mode: 'FIXED', per: 'LINE', percentBps: null, amount: inr('5000') } }] },
  { id: 'q-note', kind: 'TEXT', label: 'Note', help: null, required: true, minPicks: null, maxPicks: null, freePicks: null, maxLength: 20, multiline: false, example: 'Happy birthday', accept: null, maxFiles: null, versionIds: null, shownIf: { questionId: 'q-wrap', choiceId: 'c-yes' }, price: null, choices: [] },
]
/** The sheet's own button when the page has one of the same name (Add to cart): the last on screen. */
const pressInSheet = async (screen: Awaited<ReturnType<typeof render>>, name: string) => {
  const found = screen.root.findAll((node) => typeof node.props.onPress === 'function' && (node.props.accessibilityLabel === name || node.props.label === name))
  const target = found[found.length - 1]
  if (!target) throw new Error(`No button "${name}"`)
  await act(async () => target.props.onPress())
}
const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 300)))
const quote = (total: string, problems: { questionId: string; reason: string }[] = []) => ({ customisationQuote: { lineTotal: inr(total), problems } })

describe('the customisation sheet', () => {
  it('opens on Add to cart for a product with questions, shows the Shop API’s total, holds a required answer, and adds with the answers', async () => {
    const shop = fakeShop(({ query, variables }) => {
      if (query.includes('customisationQuote')) {
        const answers = (variables?.['answers'] as unknown[]) ?? []
        return answers.length === 1 ? quote('154900', [{ questionId: 'q-note', reason: 'REQUIRED' }]) : quote(answers.length === 0 ? '149900' : '154900')
      }
      if (query.includes('addToCart')) return { addToCart: { cartToken: 'cart-1' } }
      return productAnswer(tee({ questions }))
    })
    const screen = await render(<ProductScreen slug="tee-p1" />, shop)
    await press(screen, 'Sand')
    await press(screen, 'M')
    await press(screen, t('product.addToCart'))
    expect(hasText(screen, t('customise.title', { name: 'Linen Tee' }))).toBe(true)
    await wait()
    expect(hasText(screen, '₹1,499.00')).toBe(true)
    await press(screen, 'Yes, +₹50.00')
    await wait()
    await pressInSheet(screen, t('customise.add'))
    expect(hasText(screen, t('customise.problem.REQUIRED'))).toBe(true)
    expect(shop.requests.some((r) => r.query.includes('addToCart'))).toBe(false)
    await fill(screen, 'Note', 'Asha')
    await wait()
    await pressInSheet(screen, t('customise.add'))
    const add = shop.requests.find((r) => r.query.includes('addToCart'))
    expect(add?.variables).toEqual({ versionId: 'ver-sand-m', quantity: 1, answers: [{ questionId: 'q-wrap', choices: [{ choiceId: 'c-yes', quantity: 1 }] }, { questionId: 'q-note', text: 'Asha' }] })
    expect(shop.cartTokens).toEqual(['cart-1'])
    expect(hasText(screen, t('product.added'))).toBe(true)
  })

  it('adds a product without questions directly, as before', async () => {
    const shop = fakeShop(({ query }) => (query.includes('addToCart') ? { addToCart: { cartToken: 'cart-2' } } : productAnswer(tee({ questions: [] }))))
    const screen = await render(<ProductScreen slug="tee-p1" />, shop)
    await press(screen, 'Sand')
    await press(screen, 'M')
    await press(screen, t('product.addToCart'))
    expect(shop.requests.find((r) => r.query.includes('addToCart'))?.variables).toEqual({ versionId: 'ver-sand-m', quantity: 1 })
    expect(hasText(screen, t('customise.title', { name: 'Linen Tee' }))).toBe(false)
  })

  it('says plainly when the cart already holds this version with other answers', async () => {
    const { ApiError } = jest.requireActual('@dripfunnel/mobile-shared/graphql') as typeof import('@dripfunnel/mobile-shared/graphql')
    const shop = fakeShop(({ query }) => {
      if (query.includes('customisationQuote')) return quote('149900')
      if (query.includes('addToCart')) throw new ApiError('ONE_LINE_PER_VERSION', 'refused')
      return productAnswer(tee({ questions: [{ ...questions[0], required: false }] }))
    })
    const screen = await render(<ProductScreen slug="tee-p1" />, shop)
    await press(screen, 'Sand')
    await press(screen, 'M')
    await press(screen, t('product.addToCart'))
    await wait()
    await pressInSheet(screen, t('customise.add'))
    expect(hasText(screen, t('customise.refused.ONE_LINE_PER_VERSION'))).toBe(true)
  })
})

describe('a customised cart line', () => {
  const customised = cartLine('p1', {
    id: 'line-1',
    versionId: 'ver-sand-m',
    productSlug: 'tee-p1',
    answers: [{ questionId: 'q-wrap', question: 'Gift wrap', kind: 'CHOICE', text: null, amount: inr('5000'), choices: [{ choiceId: 'c-yes', label: 'Yes', quantity: 1 }], uploads: [] }],
  })

  it('shows its answers, and Edit reopens the sheet filled in and saves through updateCartLineAnswers', async () => {
    const shop = fakeShop(({ query }) => {
      if (query.includes('updateCartLineAnswers')) return { updateCartLineAnswers: { cart: null, cartToken: null } }
      if (query.includes('customisationQuote')) return quote('154900')
      if (query.includes('product(slug')) return productAnswer(tee({ questions }))
      return { cart: { email: '', phone: '', needsShipping: true, currency: 'INR', readyToPay: false, problems: [], subtotal: inr('154900'), discount: null, shipping: null, total: inr('154900'), tax: null, codes: [], discounts: [], lines: [customised], shippingAddress: null, shippingOption: null, shippingOptions: [] } }
    })
    const screen = await render(<CartScreen />, shop)
    expect(hasText(screen, 'Gift wrap: Yes +₹50.00')).toBe(true)
    await press(screen, t('customise.edit'))
    expect(hasText(screen, t('customise.editTitle', { name: 'Linen Tee' }))).toBe(true)
    await fill(screen, 'Note', 'Hi')
    await wait()
    await press(screen, t('customise.save'))
    expect(shop.requests.find((r) => r.query.includes('updateCartLineAnswers'))?.variables).toEqual({ lineId: 'line-1', answers: [{ questionId: 'q-wrap', choices: [{ choiceId: 'c-yes', quantity: 1 }] }, { questionId: 'q-note', text: 'Hi' }] })
  })

  it('reads "Check your choices" on a line whose answers no longer fit', async () => {
    const shop = fakeShop(() => ({ cart: { email: '', phone: '', needsShipping: true, currency: 'INR', readyToPay: false, problems: ['LINE_PROBLEM'], subtotal: inr('149900'), discount: null, shipping: null, total: inr('149900'), tax: null, codes: [], discounts: [], lines: [{ ...customised, answers: [], problem: 'check_answers' }], shippingAddress: null, shippingOption: null, shippingOptions: [] } }))
    const screen = await render(<CartScreen />, shop)
    expect(hasText(screen, t('customise.check'))).toBe(true)
    expect(hasText(screen, t('cart.problem.check_answers'))).toBe(true)
  })
})
