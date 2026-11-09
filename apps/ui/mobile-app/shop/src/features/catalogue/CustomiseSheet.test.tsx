import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ImagePicker from 'expo-image-picker'
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
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///photo.jpg', mimeType: 'image/jpeg', fileName: 'photo.jpg' }] })),
}))
let mockOnline = true
jest.mock('@dripfunnel/mobile-shared/connection', () => ({ ...jest.requireActual('@dripfunnel/mobile-shared/connection'), useOnline: () => mockOnline }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))

beforeEach(() => {
  mockOnline = true
  return AsyncStorage.clear()
})

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

describe('the sheet’s rules and states', () => {
  const rules = [
    { ...questions[0], required: false, choices: [{ id: 'c-gold', label: 'Gold foil', available: false, maxQuantity: 1, photo: null, price: null }, { id: 'c-yes', label: 'Yes', available: true, maxQuantity: 1, photo: null, price: null }] },
    questions[1],
  ]
  const opened = async (answer: (query: string, variables: Record<string, unknown> | undefined) => unknown) => {
    const shop = fakeShop(({ query, variables }) => answer(query, variables) ?? productAnswer(tee({ questions: rules })))
    const screen = await render(<ProductScreen slug="tee-p1" />, shop)
    await press(screen, 'Sand')
    await press(screen, 'M')
    await press(screen, t('product.addToCart'))
    return { shop, screen }
  }

  it('greys an unavailable choice and asks a condition’s question only once its choice is picked', async () => {
    const { screen } = await opened((query) => (query.includes('customisationQuote') ? quote('149900') : undefined))
    const gold = screen.root.findAll((node) => node.props.accessibilityLabel === 'Gold foil, Not available' && typeof node.props.onPress === 'function')[0]
    expect(gold?.props.disabled).toBe(true)
    expect(hasText(screen, 'Note (Required)')).toBe(false)
    await press(screen, 'Yes')
    expect(hasText(screen, 'Note (Required)')).toBe(true)
  })

  it('says a problem no question on screen can show, rather than nothing', async () => {
    const { screen, shop } = await opened((query) => (query.includes('customisationQuote') ? quote('149900', [{ questionId: null as unknown as string, reason: 'CHOICE_UNAVAILABLE' }]) : undefined))
    await wait()
    await pressInSheet(screen, t('customise.add'))
    expect(hasText(screen, t('customise.problem.CHOICE_UNAVAILABLE'))).toBe(true)
    expect(shop.requests.some((r) => r.query.includes('addToCart'))).toBe(false)
  })

  it('says it is offline at Confirm, keeping what was typed', async () => {
    mockOnline = false
    const { screen, shop } = await opened((query) => (query.includes('customisationQuote') ? quote('149900') : undefined))
    await pressInSheet(screen, t('customise.add'))
    expect(hasText(screen, t('customise.offline'))).toBe(true)
    expect(shop.requests.some((r) => r.query.includes('addToCart'))).toBe(false)
  })
})

describe('the sheet’s uploads', () => {
  const photoQuestion = [{ id: 'q-photo', kind: 'UPLOAD', label: 'Your photo', help: null, required: false, minPicks: null, maxPicks: null, freePicks: null, maxLength: null, multiline: null, example: null, accept: 'IMAGE', maxFiles: 1, versionIds: null, shownIf: null, price: null, choices: [] }]
  const realFetch = global.fetch
  const realXhr = global.XMLHttpRequest
  afterEach(() => {
    global.fetch = realFetch
    global.XMLHttpRequest = realXhr
  })

  it('uploads a photo from the library with its progress, and takes it back when the sheet is cancelled', async () => {
    const calls: string[] = []
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      return { ok: true, blob: async () => new Blob(['x']), text: async () => '{}' } as unknown as Response
    }) as unknown as typeof fetch
    class Fake {
      upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
      onload: (() => void) | null = null
      onerror = null
      status = 200
      responseText = JSON.stringify({ id: 'file-1', kind: 'image', cartToken: 'cart-up' })
      open(_: string, url: string) {
        calls.push(`POST ${url}`)
      }
      setRequestHeader() {}
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 })
        this.onload?.()
      }
    }
    global.XMLHttpRequest = Fake as unknown as typeof XMLHttpRequest
    const shop = fakeShop(({ query }) => (query.includes('customisationQuote') ? quote('149900') : productAnswer(tee({ questions: photoQuestion }))))
    const screen = await render(<ProductScreen slug="tee-p1" />, shop)
    await press(screen, 'Sand')
    await press(screen, 'M')
    await press(screen, t('product.addToCart'))
    await press(screen, t('customise.addPhoto'))
    await wait()
    expect(calls).toContain('POST https://acme.my-store.one/shop-api/uploads?question=q-photo')
    expect(shop.cartTokens).toEqual(['cart-up'])
    expect(hasText(screen, 'photo.jpg')).toBe(true)
    await pressInSheet(screen, t('customise.cancel'))
    expect(calls).toContain('DELETE https://acme.my-store.one/shop-api/uploads/file-1')
  })

  it('says when Edit can’t read the product’s questions', async () => {
    const line = cartLine('p1', { id: 'line-9', versionId: 'ver-sand-m', productSlug: 'tee-p1', answers: [{ questionId: 'gone', question: 'Old', kind: 'TEXT', text: 'x', amount: null, choices: [], uploads: [] }] })
    const shop = fakeShop(({ query }) =>
      query.includes('product(slug')
        ? productAnswer(tee({ questions: [] }))
        : { cart: { email: '', phone: '', needsShipping: true, currency: 'INR', readyToPay: false, problems: [], subtotal: inr('149900'), discount: null, shipping: null, total: inr('149900'), tax: null, codes: [], discounts: [], lines: [line], shippingAddress: null, shippingOption: null, shippingOptions: [] } },
    )
    const screen = await render(<CartScreen />, shop)
    await press(screen, t('customise.edit'))
    expect(hasText(screen, t('customise.editFailed'))).toBe(true)
  })
})

describe('the sheet’s uploads, harder cases', () => {
  const photoQuestion = [{ id: 'q-photo', kind: 'UPLOAD', label: 'Your photo', help: null, required: false, minPicks: null, maxPicks: null, freePicks: null, maxLength: null, multiline: null, example: null, accept: 'IMAGE', maxFiles: 2, versionIds: null, shownIf: null, price: null, choices: [] }]
  const realFetch = global.fetch
  const realXhr = global.XMLHttpRequest
  afterEach(() => {
    global.fetch = realFetch
    global.XMLHttpRequest = realXhr
  })
  const fakeNetwork = (status: number, body: unknown, hold = false, deleteRefused = false) => {
    const calls: string[] = []
    let finish: () => void = () => undefined
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (init?.method === 'DELETE' && deleteRefused) return { ok: false, text: async () => JSON.stringify({ errors: [{ extensions: { code: 'INTERNAL' } }] }) } as unknown as Response
      return { ok: true, blob: async () => new Blob(['x']), text: async () => '{}' } as unknown as Response
    }) as unknown as typeof fetch
    class Fake {
      upload = { onprogress: null }
      onload: (() => void) | null = null
      onerror = null
      status = status
      responseText = JSON.stringify(body)
      open() {}
      setRequestHeader() {}
      send() {
        if (hold) finish = () => this.onload?.()
        else this.onload?.()
      }
    }
    global.XMLHttpRequest = Fake as unknown as typeof XMLHttpRequest
    return { calls, finish: () => finish() }
  }
  const openWith = async (extra: (query: string) => unknown = () => undefined) => {
    const shop = fakeShop(({ query }) => extra(query) ?? (query.includes('customisationQuote') ? quote('149900') : productAnswer(tee({ questions: photoQuestion }))))
    const screen = await render(<ProductScreen slug="tee-p1" />, shop)
    await press(screen, 'Sand')
    await press(screen, 'M')
    await press(screen, t('product.addToCart'))
    return { shop, screen }
  }

  it('words a refused file by its code', async () => {
    fakeNetwork(415, { errors: [{ extensions: { code: 'FILE_TYPE' } }] })
    const { screen } = await openWith()
    await press(screen, t('customise.addPhoto'))
    await wait()
    expect(hasText(screen, t('customise.refused.FILE_TYPE'))).toBe(true)
  })

  it('never keeps a file removed while it was still uploading, and takes it back', async () => {
    const net = fakeNetwork(200, { id: 'late', kind: 'image' }, true)
    const { screen } = await openWith()
    await press(screen, t('customise.addPhoto'))
    await wait()
    await press(screen, t('customise.remove', { name: 'photo.jpg' }))
    await act(async () => net.finish())
    await wait()
    expect(net.calls).toContain('DELETE https://acme.my-store.one/shop-api/uploads/late')
    expect(hasText(screen, 'photo.jpg')).toBe(false)
  })

  it('says when photos are off for the app, and uploads nothing', async () => {
    const net = fakeNetwork(200, { id: 'never', kind: 'image' })
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValueOnce({ granted: false } as Awaited<ReturnType<typeof ImagePicker.requestMediaLibraryPermissionsAsync>>)
    const { screen } = await openWith()
    await press(screen, t('customise.addPhoto'))
    await wait()
    expect(hasText(screen, t('customise.photosDenied'))).toBe(true)
    expect(net.calls.some((c) => c.includes('/uploads'))).toBe(false)
  })

  it('puts a file back, saying so, when deleting it fails, and tries again on the next remove', async () => {
    const net = fakeNetwork(200, { id: 'kept', kind: 'image' }, false, true)
    const { screen } = await openWith()
    await press(screen, t('customise.addPhoto'))
    await wait()
    await press(screen, t('customise.remove', { name: 'photo.jpg' }))
    await wait()
    expect(hasText(screen, 'photo.jpg')).toBe(true)
    expect(hasText(screen, t('customise.removeFailed'))).toBe(true)
    await press(screen, t('customise.remove', { name: 'photo.jpg' }))
    await wait()
    expect(net.calls.filter((c) => c === 'DELETE https://acme.my-store.one/shop-api/uploads/kept')).toHaveLength(2)
  })

  it('keeps Cancel off while the cart takes the answers', async () => {
    fakeNetwork(200, {})
    let release: (() => void) | null = null
    const { screen } = await openWith((query) => (query.includes('addToCart') ? new Promise((resolve) => (release = () => resolve({ addToCart: { cartToken: null } }))) : undefined))
    await wait()
    await pressInSheet(screen, t('customise.add'))
    await wait()
    const cancels = screen.root.findAll((node) => node.props.label === t('customise.cancel'))
    expect(cancels[cancels.length - 1]?.props.disabled).toBe(true)
    expect(release).not.toBeNull()
    await act(async () => release?.())
    await wait()
  })
})

describe('Edit and a file already on the line', () => {
  it('leaves a saved file to Save rather than deleting it at once', async () => {
    const calls: string[] = []
    const realFetch = global.fetch
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => (calls.push(`${init?.method ?? 'GET'} ${url}`), { ok: true, text: async () => '{}' } as unknown as Response)) as unknown as typeof fetch
    const photo = [{ id: 'q-photo', kind: 'UPLOAD', label: 'Your photo', help: null, required: false, minPicks: null, maxPicks: null, freePicks: null, maxLength: null, multiline: null, example: null, accept: 'IMAGE', maxFiles: 1, versionIds: null, shownIf: null, price: null, choices: [] }]
    const line = cartLine('p1', { id: 'line-f', versionId: 'ver-sand-m', productSlug: 'tee-p1', answers: [{ questionId: 'q-photo', question: 'Your photo', kind: 'UPLOAD', text: null, amount: null, choices: [], uploads: [{ id: 'saved-file' }] }] })
    const shop = fakeShop(({ query }) =>
      query.includes('customisationQuote')
        ? quote('149900')
        : query.includes('product(slug')
          ? productAnswer(tee({ questions: photo }))
          : { cart: { email: '', phone: '', needsShipping: true, currency: 'INR', readyToPay: false, problems: [], subtotal: inr('149900'), discount: null, shipping: null, total: inr('149900'), tax: null, codes: [], discounts: [], lines: [line], shippingAddress: null, shippingOption: null, shippingOptions: [] } },
    )
    const screen = await render(<CartScreen />, shop)
    await press(screen, t('customise.edit'))
    await press(screen, t('customise.remove', { name: t('customise.file', { number: 1 }) }))
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false)
    global.fetch = realFetch
  })
})

