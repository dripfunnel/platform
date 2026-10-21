import { act } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../../graphql'
import { fakeApi, type Call } from '../../../testing/fakeApi'
import { actingAs, hasText, press, pressableNamed, pressablesNamed, renderShell } from '../../../testing/harness'
import { resetScenario } from '../../states/scenario'
import { StoryScreen } from './StoryScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }), useNavigation: () => ({ dispatch: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }))
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(), requestCameraPermissionsAsync: async () => ({ granted: true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../files', () => ({ fileDeps: () => ({ domain: 'shop.test', headers: () => ({}) }) }))
jest.mock('../../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>

const module = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, kind, title: null, body: null, side: null, photo: null, items: null, photos: null, productIds: null, blockId: null, video: null, ...extra })
const story = (over: Record<string, unknown> = {}) => ({
  revision: 3,
  status: 'live',
  template: 'fashion',
  publishedAt: '2026-10-01T10:00:00Z',
  products: [],
  modules: [module('m-banner', 'banner', { title: 'Made to be lived in', photo: { assetId: 'a-1', alt: 'A shirt on a chair' } }), module('m-text', 'imageText', { title: 'From flax to shirt', body: 'Grown and woven in one region.', side: 'left' })],
  ...over,
})

const base = (over: { permissions?: string[]; seller?: { id: string } | null; story?: unknown; features?: unknown[] } = {}): Handlers => ({
  'acting { permissions': () => ({ me: { acting: { permissions: over.permissions ?? ['catalog.read', 'catalog.write'], seller: over.seller ?? null } } }),
  catalogueSettings: () => ({ catalogueSettings: { pricingCurrency: 'INR', features: over.features ?? [{ key: 'aplus', enabled: true, inPlan: true }, { key: 'video', enabled: true, inPlan: true }] } }),
  'product(id': () => ({
    product: { id: 'p-1', revision: 1, name: 'Mara Linen Shirt', description: '', productType: 'physical', visible: true, approval: null, sentBackReason: null, supplier: null, shared: false, slug: 'mara', category: null, sizeChartId: null, warrantyText: null, returnsText: null, seoTitle: null, seoDescription: null, pricingCurrency: 'INR', photos: [], options: [], versions: [], readiness: null },
  }),
  'productStory(productId': () => ({ productStory: over.story ?? story() }),
  'storyBlocks(first': () => ({ storyBlocks: { nodes: [{ id: 'sb-1', name: 'Our studio' }], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } } }),
})

const open = async (handlers: Handlers, options: Parameters<typeof renderShell>[1] & { supplier?: string } = {}) => {
  const { client, calls } = fakeApi(handlers, { supplier: options.supplier ?? null })
  mockSession.client = client
  const renderer = await renderShell(<StoryScreen id="p-1" />, options)
  await settle()
  return { renderer, calls }
}

const calledWith = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('A+ content', () => {
  it('opens a live story with its state, its count and each module as a card', async () => {
    const { renderer } = await open(base())

    expect(hasText(renderer, 'Live on your store')).toBe(true)
    expect(hasText(renderer, '2 of 10 modules')).toBe(true)
    expect(hasText(renderer, 'Large banner')).toBe(true)
    expect(hasText(renderer, 'From flax to shirt')).toBe(true)
  })

  it('adds a module from the palette and saves only the draft, with each field its kind has', async () => {
    const { renderer, calls } = await open({
      ...base(),
      'mutation SaveStory': () => ({ saveProductStory: story({ revision: 4, status: 'changed' }) }),
    })

    await press(pressableNamed(renderer, 'Add a module'))
    await press(pressableNamed(renderer, 'Image + text'))
    expect(hasText(renderer, 'Unsaved changes')).toBe(true)
    expect(hasText(renderer, '3 of 10 modules')).toBe(true)

    await press(pressableNamed(renderer, 'Save draft'))
    await settle()
    const sent = calledWith(calls, 'mutation SaveStory')[0]?.variables as { r: number; input: { modules: Record<string, unknown>[] } }
    expect(sent.r).toBe(3)
    expect(sent.input.modules).toHaveLength(3)
    expect(sent.input.modules[0]).toEqual({ id: 'm-banner', kind: 'banner', title: 'Made to be lived in', photo: { assetId: 'a-1', alt: 'A shirt on a chair' } })
    expect(sent.input.modules[2]).toMatchObject({ kind: 'imageText', side: 'left' })
    expect(sent.input.modules[2]).not.toHaveProperty('items')
    expect(calledWith(calls, 'mutation PublishStory')).toHaveLength(0)
    expect(hasText(renderer, 'Draft saved — your live page hasn’t changed')).toBe(true)
  })

  it('marks what publishing says is still to fill in, and opens that module', async () => {
    const { renderer } = await open({
      ...base(),
      'mutation SaveStory': () => ({ saveProductStory: story({ revision: 4, status: 'changed' }) }),
      'mutation PublishStory': () => {
        throw new ApiError('STORY_INCOMPLETE', 'x', { gaps: [{ moduleId: 'm-text', field: 'alt' }] })
      },
    })

    await press(pressableNamed(renderer, 'Add a module'))
    await press(pressableNamed(renderer, 'Video'))
    await press(pressableNamed(renderer, 'Publish with product'))
    await settle()

    expect(hasText(renderer, '1 thing to fill in before publishing — it’s marked.')).toBe(true)
    expect(hasText(renderer, 'Describe the photo')).toBe(true)
  })

  it('publishes with the product once the API accepts it', async () => {
    const { renderer, calls } = await open({
      ...base(),
      'mutation PublishStory': () => ({ publishProductStory: story({ revision: 4 }) }),
    })

    await press(pressableNamed(renderer, 'Publish with product'))
    await settle()

    expect(calledWith(calls, 'mutation PublishStory')[0]?.variables).toEqual({ p: 'p-1', r: 3 })
    expect(hasText(renderer, 'A+ content is live on your product page')).toBe(true)
  })

  it('says a plan without A+ content has none, with nothing to buy and nothing to edit', async () => {
    const { renderer } = await open(base({ features: [{ key: 'aplus', enabled: true, inPlan: false }] }))

    expect(hasText(renderer, 'A+ content isn’t on your plan.')).toBe(true)
    expect(hasText(renderer, 'Upgrade')).toBe(false)
    expect(pressablesNamed(renderer, 'Add a module')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Publish with product')).toHaveLength(0)
  })

  it('lets Staff look at it but not change it', async () => {
    const { renderer } = await open(base({ permissions: ['catalog.read'] }), { acting: actingAs('staff') })

    expect(hasText(renderer, 'You can look at A+ content but not change it.')).toBe(true)
    expect(pressablesNamed(renderer, 'Publish with product')).toHaveLength(0)
  })

  it('offers a supplier no brand story, and says its publish goes to the store owner', async () => {
    const { renderer, calls } = await open(
      {
        ...base({ permissions: ['catalog.read', 'catalog.write', 'stock.write'], seller: { id: 's-1' } }),
        'mutation PublishStory': () => ({ publishProductStory: story({ revision: 4 }) }),
      },
      { acting: actingAs('supplier-member', 'vendor-catalogue'), supplier: 's-1' },
    )

    expect(calledWith(calls, 'storyBlocks(first')).toHaveLength(0)
    await press(pressableNamed(renderer, 'Add a module'))
    expect(pressablesNamed(renderer, 'Brand story')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Large banner').length).toBeGreaterThan(0)
  })

  it('says a story that isn’t this seat’s is not found', async () => {
    const { renderer } = await open({ ...base(), 'productStory(productId': () => ({ productStory: null }) })

    expect(hasText(renderer, 'This page isn’t here any more')).toBe(true)
  })

  it('replaces the draft with another product’s after saying so', async () => {
    const { renderer, calls } = await open({
      ...base(),
      'products(filter': () => ({ products: { nodes: [{ id: 'p-2', name: 'Canvas Tote', visible: true, approval: null, productType: 'physical', supplier: null, supplierRemoved: false, versionCount: 1, minPrice: null, maxPrice: null, photoUrl: null, stock: 0, lowStock: false, readiness: null }], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } } }),
      'mutation CopyStory': () => ({ copyProductStory: 1 }),
    })

    await press(pressableNamed(renderer, 'Copy from another product…'))
    await settle()
    await press(pressableNamed(renderer, 'Canvas Tote'))
    expect(hasText(renderer, 'Copy A+ content from “Canvas Tote”?')).toBe(true)
    expect(hasText(renderer, 'This product’s draft is replaced with that one’s. Its live page doesn’t change until you publish.')).toBe(true)
    await press(pressablesNamed(renderer, 'Copy').at(-1) as never)
    await settle()

    expect(calledWith(calls, 'mutation CopyStory')[0]?.variables).toEqual({ from: 'p-2', to: ['p-1'] })
  })
})
