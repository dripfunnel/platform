import type { ReactElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { CollectionEditorScreen } from './CollectionEditorScreen'
import { CollectionsArea } from './CollectionsArea'
import { SizeChartEditorScreen } from './SizeChartEditorScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, navigate: jest.fn() }),
    useNavigation: () => ({ dispatch: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>
type Options = Parameters<typeof renderShell>[1]

const paged = <T,>(nodes: T[], extra: Record<string, unknown> = {}) => ({ nodes, ...extra, pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } })
const noRule = { text: null, valueId: null, productId: null, versionId: null, currency: null, min: null, max: null }
const valueRule = (valueId: string) => ({ ...noRule, kind: 'filter_value', valueId })

const filters = [
  { id: 'f-fabric', name: 'Fabric', position: 0, revision: 2, shopperVisible: true, values: [{ id: 'linen', name: 'Linen', products: 9 }, { id: 'cotton', name: 'Cotton', products: 14 }] },
  { id: 'f-occasion', name: 'Occasion', position: 1, revision: 1, shopperVisible: true, values: [{ id: 'wedding', name: 'Wedding', products: 4 }] },
  { id: 'f-colour', name: 'Colour', position: 2, revision: 1, shopperVisible: true, values: [{ id: 'off-white', name: 'Off-white', products: 6 }, { id: 'off white', name: 'Off white', products: 2 }] },
  { id: 'f-reorder', name: 'Reorder soon', position: 3, revision: 1, shopperVisible: false, values: [{ id: 'yes', name: 'Yes', products: 2 }] },
]

const summary = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, kind: 'manual', visible: true, parentId: null, inheritParent: false, match: 'all', rules: [], products: 0, computedAt: '2026-10-05T09:00:00Z', ...over })
const collections = [
  summary('c-summer', 'Summer edit', { kind: 'automatic', rules: [valueRule('linen'), valueRule('cotton')], products: 18 }),
  summary('c-men', 'Men', { products: 42 }),
  summary('c-shirts', 'Shirts', { parentId: 'c-men', inheritParent: true, kind: 'automatic', rules: [valueRule('linen')], products: 12 }),
  summary('c-wedding', 'Wedding guest', { kind: 'automatic', rules: [valueRule('wedding')], products: 7, computedAt: null }),
  summary('c-offer', 'Staff picks', { visible: false, products: 5 }),
]

const full = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: 'Summer edit',
  slug: 'summer-edit',
  description: 'Light things',
  kind: 'automatic',
  match: 'all',
  parentId: null,
  inheritParent: false,
  visible: true,
  imageAssetId: 'img-1',
  sort: 'newest',
  seoTitle: 'Summer',
  seoDescription: null,
  revision: 4,
  rules: [valueRule('linen')],
  ...over,
})

const owner = ['catalog.read', 'catalog.write']
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

const base = (over: { permissions?: string[]; seller?: { id: string } | null; collections?: unknown[]; countries?: string[]; features?: unknown[] } = {}): Handlers => ({
  'acting { permissions': () => ({ me: { acting: { permissions: over.permissions ?? owner, seller: over.seller ?? null } } }),
  'collections(first': () => ({ collections: paged(over.collections ?? collections) }),
  'facets(first': () => ({ facets: paged(filters) }),
  catalogueSettings: () => ({ catalogueSettings: { pricingCurrency: 'INR', unitSystem: 'metric', features: over.features ?? [{ key: 'sizeCharts', enabled: true, inPlan: true }] } }),
  'markets(first': () => ({ markets: paged([{ active: true, countries: over.countries ?? ['ZZ'] }]) }),
})

const show = async (element: ReactElement, handlers: Handlers, options: Options & { supplier?: string } = {}) => {
  const { client, calls } = fakeApi(handlers, { supplier: options.supplier ?? null })
  mockSession.client = client
  const renderer = await renderShell(element, options)
  await settle()
  return { renderer, calls }
}

const input = (renderer: ReactTestRenderer, label: string) => {
  const found = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!found) throw new Error(`no field named "${label}"`)
  return found
}
const type = async (renderer: ReactTestRenderer, label: string, value: string) => {
  await act(async () => input(renderer, label).props.onChangeText(value))
}
// The live preview and the product search ask a moment after typing stops.
const pause = async () => {
  await act(async () => void jest.advanceTimersByTime(400))
  await settle()
}
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))
const tab = async (renderer: ReactTestRenderer, name: string) => {
  await press(pressablesNamed(renderer, name).find((node) => node.props.accessibilityRole === 'tab') ?? pressableNamed(renderer, name))
  await settle()
}

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('the Collections list', () => {
  it('lists every collection with what the API says it holds, children under their parent', async () => {
    const { renderer } = await show(<CollectionsArea />, base())

    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['Summer edit', 'Fabric is Linen or Cotton', 'Automatic · 1 rule', '18 products', 'Men', '42 products', 'Shirts', 'Inside Men · only products also there', 'Staff picks', 'Hidden · for offers', '5 picked']),
    )
    // A rule-based collection still filling shows the API's count so far, never one worked out here.
    expect(hasText(renderer, 'Updating… 7 so far')).toBe(true)
    await press(pressableNamed(renderer, 'Open Summer edit'))
    expect(mockPush).toHaveBeenCalledWith('/catalogue/collections/c-summer')
  })

  it('starts a collection, and one from a seasonal idea for the markets’ countries', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-06T00:00:00Z') })
    try {
      const { renderer } = await show(<CollectionsArea />, base({ countries: ['IN'] }))

      expect(hasText(renderer, 'Coming up in your markets:')).toBe(true)
      await press(pressableNamed(renderer, 'Create collection'))
      expect(mockPush).toHaveBeenCalledWith('/catalogue/collections/new')
      await press(pressableNamed(renderer, '+ Navratri'))
      expect(mockPush).toHaveBeenCalledWith('/catalogue/collections/new?name=Navratri')
    } finally {
      jest.useRealTimers()
    }
  })

  it('explains collections to a store with none, with an example price in its own currency', async () => {
    const { renderer } = await show(<CollectionsArea />, base({ collections: [] }))

    expect(hasText(renderer, 'Group your products')).toBe(true)
    expect(hasText(renderer, 'Gifts under ₹999')).toBe(true)
    await press(pressableNamed(renderer, 'Create your first collection'))
    expect(mockPush).toHaveBeenCalledWith('/catalogue/collections/new')
  })

  it('lets Staff look but not change: no create, no ideas', async () => {
    const { renderer } = await show(<CollectionsArea />, base({ permissions: ['catalog.read'], countries: ['IN'] }), { acting: actingAs('staff') })

    expect(hasText(renderer, 'Summer edit')).toBe(true)
    expect(hasText(renderer, 'You can look at collections but not change them.')).toBe(true)
    expect(pressablesNamed(renderer, 'Create collection')).toHaveLength(0)
    expect(hasText(renderer, 'Coming up in your markets:')).toBe(false)
  })

  it('says a seat without the catalogue has no access, and never lists a supplier’s anything', async () => {
    const { renderer } = await show(<CollectionsArea />, base({ permissions: [] }))

    expect(hasText(renderer, 'You don’t have access to Collections')).toBe(true)
    expect(hasText(renderer, 'Summer edit')).toBe(false)
  })

  it('tells a store that is read-only (past due) that it can’t create one', async () => {
    const { renderer } = await show(<CollectionsArea />, base(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Summer edit')).toBe(true)
    expect(pressablesNamed(renderer, 'Create collection')).toHaveLength(0)
  })

  it('says it couldn’t load, keeps nothing half drawn, and loads again on request', async () => {
    let fail = true
    const { renderer, calls } = await show(<CollectionsArea />, {
      ...base(),
      'collections(first': () => {
        if (fail) throw new ApiError('NO_RESPONSE', 'x')
        return { collections: paged(collections) }
      },
    })

    expect(hasText(renderer, 'We couldn’t load Collections')).toBe(true)
    fail = false
    await press(pressableNamed(renderer, 'Try again'))
    await settle()
    expect(asked(calls, 'collections(first').length).toBeGreaterThan(1)
    expect(hasText(renderer, 'Summer edit')).toBe(true)
  })
})

describe('editing a collection’s rules', () => {
  const open = (id: string | null, handlers: Handlers, options: Options = {}, suggested: string | null = null) => show(<CollectionEditorScreen id={id} suggested={suggested} />, handlers, options)

  const editorHandlers = (over: Handlers = {}): Handlers => ({
    ...base(),
    'collection(id': () => ({ collection: full('c-summer') }),
    'collectionProducts(': () => ({ collectionProducts: paged([]) }),
    '{ menu {': () => ({ menu: { name: 'Main menu', revision: 2, items: [{ id: 'm1', parentId: null, kind: 'collection', label: 'Summer edit', collectionId: 'c-summer', url: null }] } }),
    'collectionPreview(': () => ({ collectionPreview: { count: 2, products: [{ id: 'p1', name: 'Mara Linen Shirt' }, { id: 'p2', name: 'Indigo Linen Kurta' }] } }),
    ...over,
  })

  it('sends a rule edit back in the API’s shape, at its revision, keeping what it has no control for', async () => {
    const { renderer, calls } = await open('c-summer', editorHandlers({ 'mutation SaveCollection': () => ({ saveCollection: { id: 'c-summer', revision: 5 } }) }))

    expect(hasText(renderer, 'Where')).toBe(true)
    await press(pressableNamed(renderer, 'Cotton'))
    await type(renderer, 'Name', 'Summer edit 2')
    await press(pressableNamed(renderer, 'Save collection'))
    await settle()

    const sent = asked(calls, 'mutation SaveCollection')[0]
    expect(sent?.variables).toEqual({
      id: 'c-summer',
      revision: 4,
      input: {
        name: 'Summer edit 2',
        description: 'Light things',
        kind: 'automatic',
        match: 'all',
        parentId: null,
        inheritParent: false,
        visible: true,
        rules: [{ kind: 'filter_value', valueId: 'linen' }, { kind: 'filter_value', valueId: 'cotton' }],
        productIds: [],
        imageAssetId: 'img-1',
        sort: 'newest',
        seoTitle: 'Summer',
        seoDescription: null,
      },
    })
    expect(hasText(renderer, '“Summer edit 2” saved — filling in the background')).toBe(true)
    expect(mockBack).toHaveBeenCalled()
  })

  it('shows what the API says the rules would hold, asking again as they change, and never matches products itself', async () => {
    jest.useFakeTimers()
    try {
      const { renderer, calls } = await open('c-summer', editorHandlers())
      await pause()

      expect(hasText(renderer, '2 products match')).toBe(true)
      expect(texts(renderer)).toEqual(expect.arrayContaining(['Mara Linen Shirt', 'Indigo Linen Kurta']))
      expect(asked(calls, 'collectionPreview(')[0]?.variables).toMatchObject({ match: 'all', rules: [{ kind: 'filter_value', valueId: 'linen' }], parent: null })
      expect(asked(calls, 'products(filter')).toHaveLength(0)

      await press(pressableNamed(renderer, 'any of these rules'))
      await pause()
      expect(asked(calls, 'collectionPreview(').at(-1)?.variables).toMatchObject({ match: 'any' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('keeps rules it doesn’t draw as they are and says so', async () => {
    const { renderer, calls } = await open(
      'c-summer',
      editorHandlers({
        'collection(id': () => ({ collection: full('c-summer', { rules: [valueRule('linen'), { ...noRule, kind: 'price_range', currency: 'INR', min: '0', max: '99900' }] }) }),
        'mutation SaveCollection': () => ({ saveCollection: { id: 'c-summer', revision: 5 } }),
      }),
    )

    expect(hasText(renderer, '1 more rule this screen doesn’t change is kept as it is.')).toBe(true)
    await type(renderer, 'Name', 'Summer')
    await press(pressableNamed(renderer, 'Save collection'))
    await settle()
    expect((asked(calls, 'mutation SaveCollection')[0]?.variables.input as { rules: unknown[] }).rules).toContainEqual({ kind: 'filter_value', valueId: 'linen' })
    expect((asked(calls, 'mutation SaveCollection')[0]?.variables.input as { rules: unknown[] }).rules).toContainEqual({ kind: 'price_range', currency: 'INR', min: '0', max: '99900' })
  })

  it('picks products by hand from a search of the store’s, and sends them with no rules', async () => {
    jest.useFakeTimers()
    try {
      const { renderer, calls } = await open(
        null,
        editorHandlers({
          'products(filter': () => ({ products: paged([{ id: 'p1', name: 'Mara Linen Shirt', visible: true, approval: null }, { id: 'p2', name: 'Silk Dupatta', visible: false, approval: null }]) }),
          'mutation SaveCollection': () => ({ saveCollection: { id: 'c-new', revision: 1 } }),
        }),
        {},
        'Navratri',
      )
      await pause()

      expect((input(renderer, 'Name').props as { value: string }).value).toBe('Navratri')
      expect(hasText(renderer, 'Silk Dupatta')).toBe(true)
      expect(hasText(renderer, 'Hidden')).toBe(true)
      await press(pressableNamed(renderer, 'Mara Linen Shirt'))
      expect(hasText(renderer, '1 product picked so far. Tap one to take it out.')).toBe(true)
      await press(pressableNamed(renderer, 'Save collection'))
      await settle()

      expect(asked(calls, 'mutation SaveCollection')[0]?.variables).toMatchObject({ id: null, revision: null, input: { name: 'Navratri', kind: 'manual', rules: [], productIds: ['p1'] } })
      expect(asked(calls, 'collectionPreview(')).toHaveLength(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('asks for a name before sending anything', async () => {
    const { renderer, calls } = await open(null, editorHandlers())

    await press(pressableNamed(renderer, 'Save collection'))

    expect(hasText(renderer, 'Give the collection a name')).toBe(true)
    expect(asked(calls, 'mutation SaveCollection')).toHaveLength(0)
  })

  it.each([
    ['TOO_MANY_RULES', 'A collection can have up to 20 rules.'],
    ['INVALID_RULE', 'A rule names a filter value that isn’t here any more. Remove it and save again.'],
    ['INVALID_PARENT', 'Choose another collection as the parent — never this one or one inside it.'],
    ['STALE_REVISION', 'Someone else saved this collection first. Open it again to see their changes.'],
    ['READ_ONLY', 'Your store is read-only until the bill is paid.'],
    ['SOMETHING_NEW', 'That didn’t save. Try again.'],
  ])('shows a refused save (%s) in the app’s words, never the API’s, and keeps what was typed', async (code, words) => {
    const { renderer } = await open(
      'c-summer',
      editorHandlers({
        'mutation SaveCollection': () => {
          throw new ApiError(code, 'API words that are never shown')
        },
      }),
    )

    await type(renderer, 'Name', 'Summer 2')
    await press(pressableNamed(renderer, 'Save collection'))
    await settle()

    expect(hasText(renderer, words)).toBe(true)
    expect(hasText(renderer, 'API words that are never shown')).toBe(false)
    expect((input(renderer, 'Name').props as { value: string }).value).toBe('Summer 2')
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('says what deleting does before it does it, including that it is in the menu', async () => {
    const { renderer, calls } = await open('c-summer', editorHandlers({ 'mutation DeleteCollection': () => ({ deleteCollection: true }) }))

    await press(pressableNamed(renderer, 'Delete collection'))
    expect(hasText(renderer, 'Delete “Summer edit”?')).toBe(true)
    expect(hasText(renderer, 'The 18 products stay in your catalogue — only the group goes.')).toBe(true)
    expect(hasText(renderer, 'It’s in your menu too; we’ll take it out and move anything nested under it up a level.')).toBe(true)
    expect(asked(calls, 'mutation DeleteCollection')).toHaveLength(0)

    const confirms = pressablesNamed(renderer, 'Delete collection')
    await press(confirms[confirms.length - 1] as (typeof confirms)[number])
    await settle()
    expect(asked(calls, 'mutation DeleteCollection')[0]?.variables).toEqual({ id: 'c-summer' })
    expect(hasText(renderer, '“Summer edit” deleted. Its products are untouched.')).toBe(true)
    expect(mockBack).toHaveBeenCalled()
  })

  it('lets Staff look at one but not change it', async () => {
    const { renderer } = await open('c-summer', editorHandlers({ 'acting { permissions': () => ({ me: { acting: { permissions: ['catalog.read'], seller: null } } }) }), { acting: actingAs('staff') })

    expect(hasText(renderer, 'You can look at collections but not change them.')).toBe(true)
    expect((input(renderer, 'Name').props as { editable: boolean }).editable).toBe(false)
    expect(pressablesNamed(renderer, 'Save collection')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Delete collection')).toHaveLength(0)
  })

  it('draws the shell’s 404 for a collection that isn’t here', async () => {
    const { renderer } = await open('gone', editorHandlers({ 'collection(id': () => ({ collection: null }) }))

    expect(hasText(renderer, 'This page isn’t here any more')).toBe(true)
  })
})

describe('Filters', () => {
  const open = async (handlers: Handlers = {}, options: Options = {}) => {
    const shown = await show(<CollectionsArea />, { ...base(), ...handlers }, options)
    await tab(shown.renderer, 'Filters')
    return shown
  }

  it('lists each filter with its values and how many products use each', async () => {
    const { renderer } = await open()

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Fabric', 'Linen', 'Cotton', 'Occasion', 'Used by 2 collections', 'Shoppers see this', 'Only you see these']))
    expect(hasText(renderer, '“Off-white” and “Off white” look like the same thing.')).toBe(true)
  })

  it('says how many products a rename touches before it does, then sends every value the filter keeps', async () => {
    const { renderer, calls } = await open({ 'mutation SaveFilter': () => ({ saveFacet: 'f-fabric' }) })

    await press(pressableNamed(renderer, 'Linen9'))
    await press(pressableNamed(renderer, 'Rename'))
    expect(hasText(renderer, '9 products use it. Renaming keeps them all; deleting takes it off them.')).toBe(true)
    await act(async () => renderer.root.findAll((node) => node.props.accessibilityLabel === 'Rename to' && typeof node.props.onChangeText === 'function')[0]?.props.onChangeText('Flax linen'))
    await press(pressableNamed(renderer, 'Save name'))
    await settle()

    expect(asked(calls, 'mutation SaveFilter')[0]?.variables).toEqual({
      input: { id: 'f-fabric', revision: 2, name: 'Fabric', position: 0, shopperVisible: true, values: [{ id: 'linen', name: 'Flax linen' }, { id: 'cotton', name: 'Cotton' }] },
    })
    expect(hasText(renderer, 'Renamed to “Flax linen” — 9 products updated')).toBe(true)
  })

  it('says what deleting a value takes off, and sends the filter without it', async () => {
    const { renderer, calls } = await open({ 'mutation SaveFilter': () => ({ saveFacet: 'f-occasion' }) })

    await press(pressableNamed(renderer, 'Wedding4'))
    await press(pressableNamed(renderer, 'Delete value'))
    expect(hasText(renderer, '4 products lose it, and automatic collections using it will shrink.')).toBe(true)
    await press(pressableNamed(renderer, 'Delete'))
    await settle()

    expect((asked(calls, 'mutation SaveFilter')[0]?.variables.input as { values: unknown[] }).values).toEqual([])
    expect(hasText(renderer, '“Wedding” deleted')).toBe(true)
  })

  it('offers to merge look-alike values and says how many products move', async () => {
    const { renderer, calls } = await open({ 'mutation MergeValues': () => ({ mergeFacetValues: 1 }) })

    await press(pressableNamed(renderer, 'Merge them'))
    expect(hasText(renderer, '2 products using “Off white” will use “Off-white”.')).toBe(true)
    await press(pressableNamed(renderer, 'Merge'))
    await settle()

    expect(asked(calls, 'mutation MergeValues')[0]?.variables).toEqual({ into: 'off-white', from: ['off white'] })
  })

  it('says what hiding a filter from shoppers does before it does it', async () => {
    const { renderer, calls } = await open({ 'mutation SaveFilter': () => ({ saveFacet: 'f-fabric' }) })

    await press(pressableNamed(renderer, 'Fabric: shoppers see this. Make it internal'))
    expect(hasText(renderer, 'Shoppers will no longer see Fabric as a filter on your shop. Only your team sees it, and automatic collections keep using it.')).toBe(true)
    expect(asked(calls, 'mutation SaveFilter')).toHaveLength(0)
    await press(pressableNamed(renderer, 'Make internal'))
    await settle()

    expect((asked(calls, 'mutation SaveFilter')[0]?.variables.input as { shopperVisible: boolean }).shopperVisible).toBe(false)
  })

  it('creates a filter by name, and shows a refusal by its code', async () => {
    const { renderer } = await open({
      'mutation SaveFilter': () => {
        throw new ApiError('DUPLICATE_NAME', 'x')
      },
    })

    await press(pressableNamed(renderer, 'Create filter'))
    await act(async () => renderer.root.findAll((node) => node.props.accessibilityLabel === 'Name' && typeof node.props.onChangeText === 'function')[0]?.props.onChangeText('Fabric'))
    await press(pressableNamed(renderer, 'Create'))
    await settle()

    expect(hasText(renderer, 'Another filter already has that name.')).toBe(true)
  })

  it('lets Staff look but not change', async () => {
    const { renderer } = await open({ 'acting { permissions': () => ({ me: { acting: { permissions: ['catalog.read'], seller: null } } }) }, { acting: actingAs('staff') })

    expect(hasText(renderer, 'You can look at filters but not change them.')).toBe(true)
    expect(pressablesNamed(renderer, 'Create filter')).toHaveLength(0)
    expect(pressablesNamed(renderer, '+ Add')).toHaveLength(0)
  })
})

describe('Menus', () => {
  const menu = (revision = 3) => ({ menu: { name: 'Main menu', revision, items: [{ id: 'm1', parentId: null, kind: 'collection', label: 'Summer edit', collectionId: 'c-summer', url: null }, { id: 'm2', parentId: null, kind: 'collection', label: 'Men', collectionId: 'c-men', url: null }, { id: 'm3', parentId: 'm2', kind: 'collection', label: 'Shirts', collectionId: 'c-shirts', url: null }] } })

  const open = async (handlers: Handlers = {}, options: Options = {}) => {
    const shown = await show(<CollectionsArea />, { ...base(), '{ menu {': () => menu(), ...handlers }, options)
    await tab(shown.renderer, 'Menus')
    return shown
  }

  it('shows the main menu and how shoppers see it on desktop and phone', async () => {
    const { renderer } = await open()

    expect(hasText(renderer, 'Main menu')).toBe(true)
    expect(texts(renderer)).toEqual(expect.arrayContaining(['Summer edit', 'Men', 'Shirts', 'How shoppers see it · desktop', 'Phone menu']))
    expect(hasText(renderer, 'Men ▾')).toBe(true)
  })

  it('saves each change at once, at the revision read, with the whole menu in the API’s shape', async () => {
    const { renderer, calls } = await open({ 'mutation SaveMenu': () => ({ saveMenu: 4 }) })

    await press(pressableNamed(renderer, 'Summer edit, 18 products'))
    await press(pressableNamed(renderer, 'Move down'))
    await settle()

    expect(asked(calls, 'mutation SaveMenu')[0]?.variables).toEqual({
      name: 'Main menu',
      revision: 3,
      items: [
        { kind: 'collection', label: 'Men', collectionId: 'c-men', children: [{ kind: 'collection', label: 'Shirts', collectionId: 'c-shirts' }] },
        { kind: 'collection', label: 'Summer edit', collectionId: 'c-summer' },
      ],
    })
    expect(hasText(renderer, 'Menu saved')).toBe(true)
  })

  it('says what removing an item does before it does, and moves what was under it up a level', async () => {
    const { renderer, calls } = await open({ 'mutation SaveMenu': () => ({ saveMenu: 4 }) })

    await press(pressableNamed(renderer, 'Men, 42 products'))
    await press(pressableNamed(renderer, 'Remove from menu'))
    expect(hasText(renderer, 'The collection stays in your catalogue. Anything nested under it moves up a level.')).toBe(true)
    expect(asked(calls, 'mutation SaveMenu')).toHaveLength(0)
    const confirms = pressablesNamed(renderer, 'Remove from menu')
    await press(confirms[confirms.length - 1] as (typeof confirms)[number])
    await settle()

    expect((asked(calls, 'mutation SaveMenu')[0]?.variables.items as { label: string }[]).map((i) => i.label)).toEqual(['Summer edit', 'Shirts'])
  })

  it('refuses to nest the first item, and one that has items under it, saying why', async () => {
    const { renderer, calls } = await open()

    await press(pressableNamed(renderer, 'Summer edit, 18 products'))
    await press(pressableNamed(renderer, 'Nest under the item above'))
    expect(hasText(renderer, 'The first item can’t be nested')).toBe(true)
    await press(pressableNamed(renderer, 'Men, 42 products'))
    await press(pressableNamed(renderer, 'Nest under the item above'))
    expect(hasText(renderer, 'An item with items under it can’t be nested')).toBe(true)
    expect(asked(calls, 'mutation SaveMenu')).toHaveLength(0)
  })

  it('puts the menu back and reads it again when someone else saved first', async () => {
    let revision = 3
    const { renderer, calls } = await open({
      '{ menu {': () => menu(revision),
      'mutation SaveMenu': () => {
        revision = 4
        throw new ApiError('STALE_REVISION', 'x')
      },
    })

    await press(pressableNamed(renderer, 'Summer edit, 18 products'))
    await press(pressableNamed(renderer, 'Move down'))
    await settle()

    expect(hasText(renderer, 'Someone else changed the menu first. It now shows their version; make your change again.')).toBe(true)
    expect(asked(calls, '{ menu {').length).toBeGreaterThan(1)
  })

  it('shows a collection that is hidden as not shown to shoppers, and leaves it out of the previews', async () => {
    const { renderer } = await open({ '{ menu {': () => ({ menu: { name: 'Main menu', revision: 1, items: [{ id: 'm1', parentId: null, kind: 'collection', label: 'Staff picks', collectionId: 'c-offer', url: null }] } }) })

    expect(hasText(renderer, 'Hidden — not shown to shoppers')).toBe(true)
    expect(hasText(renderer, 'Staff picks ▾')).toBe(false)
  })
})

describe('Size charts', () => {
  const chart = (over: Record<string, unknown> = {}) => ({
    id: 'sc-tops',
    name: 'Tops & shirts',
    unit: 'cm',
    systems: [],
    measurements: ['Chest', 'Waist'],
    rows: [{ size: 'M', values: ['96', '81'] }, { size: 'L', values: ['—', '86'] }],
    howToMeasure: [],
    fitNotes: 'Runs small',
    modelInfo: null,
    revision: 2,
    products: 24,
    supplierId: null,
    ...over,
  })
  const summaries = [
    { id: 'sc-tops', name: 'Tops & shirts', unit: 'cm', products: 24, supplierId: null },
    { id: 'sc-kurta', name: 'Kurtas', unit: 'in', products: 1, supplierId: null },
    { id: 'sc-theirs', name: 'Northwind sizes', unit: 'cm', products: 3, supplierId: 's-1' },
  ]
  const listHandlers = (over: Handlers = {}): Handlers => ({ 'sizeCharts(first': () => ({ sizeCharts: paged(summaries, { limit: 200 }) }), ...over })

  const openList = async (handlers: Handlers = {}, options: Options = {}) => {
    const shown = await show(<CollectionsArea />, { ...base(), ...listHandlers(), ...handlers }, options)
    await tab(shown.renderer, 'Size charts')
    return shown
  }

  const openEditor = (id: string, handlers: Handlers = {}, options: Options = {}) =>
    show(<SizeChartEditorScreen id={id} />, { ...base(), ...listHandlers(), 'sizeChart(id': () => ({ sizeChart: chart() }), ...handlers }, options)

  it('lists the store’s own charts with how many products use each, and how close it is to the limit', async () => {
    const { renderer } = await openList()

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Tops & shirts', '24 products · cm', 'Kurtas', '1 product · in', '2 of 200']))
    expect(hasText(renderer, 'Northwind sizes')).toBe(false)
    await press(pressableNamed(renderer, 'Open Tops & shirts'))
    expect(mockPush).toHaveBeenCalledWith('/catalogue/size-charts/sc-tops')
  })

  it('starts from a template in the store’s unit, makes the chart, and opens it', async () => {
    const { renderer, calls } = await openList({ 'mutation SaveSizeChart': () => ({ saveSizeChart: { id: 'sc-new', revision: 1 } }) })

    await press(pressableNamed(renderer, '+ New size chart'))
    expect(hasText(renderer, 'Numbers are in cm — you can switch.')).toBe(true)
    expect(hasText(renderer, 'Kurtas')).toBe(true)
    await press(pressableNamed(renderer, 'Create'))
    await settle()

    expect(asked(calls, 'mutation SaveSizeChart')[0]?.variables).toMatchObject({
      id: null,
      revision: null,
      input: { name: 'Tops & shirts', unit: 'cm', systems: [], measurements: ['Chest', 'Waist', 'Length'], rows: expect.arrayContaining([{ size: 'S', values: ['86', '71', '68'] }]) },
    })
    expect(mockPush).toHaveBeenCalledWith('/catalogue/size-charts/sc-new')
  })

  it('says the limit is reached rather than starting one', async () => {
    const { renderer } = await openList({ 'sizeCharts(first': () => ({ sizeCharts: paged(summaries.slice(0, 1), { limit: 1 }) }) })

    expect(hasText(renderer, '1 of 1')).toBe(true)
    await press(pressableNamed(renderer, 'Limit reached'))
    expect(hasText(renderer, 'You have 200 size charts, the most there can be. Delete one to make another.')).toBe(true)
  })

  it('shows the plan’s message with no way to buy, and no New button', async () => {
    const { renderer } = await openList(base({ features: [{ key: 'sizeCharts', enabled: false, inPlan: false }] }))

    expect(hasText(renderer, 'Size charts aren’t in your store’s plan.')).toBe(true)
    expect(pressablesNamed(renderer, '+ New size chart')).toHaveLength(0)
    expect(hasText(renderer, 'See plans')).toBe(false)
  })

  it('edits a chart used on one product and sends "—" for an empty cell', async () => {
    const { renderer, calls } = await openEditor('sc-tops', { 'sizeChart(id': () => ({ sizeChart: chart({ products: 1 }) }), 'mutation SaveSizeChart': () => ({ saveSizeChart: { id: 'sc-tops', revision: 3 } }) })

    expect((input(renderer, 'M, Chest').props as { value: string }).value).toBe('96')
    expect((input(renderer, 'L, Chest').props as { value: string }).value).toBe('')
    await type(renderer, 'M, Chest', '97')
    await press(pressableNamed(renderer, 'Save chart'))
    await settle()

    expect(asked(calls, 'mutation SaveSizeChart')[0]?.variables).toMatchObject({
      id: 'sc-tops',
      revision: 2,
      input: { name: 'Tops & shirts', unit: 'cm', rows: [{ size: 'M', values: ['97', '81'] }, { size: 'L', values: ['—', '86'] }], fitNotes: 'Runs small' },
    })
    expect(hasText(renderer, '“Tops & shirts” saved — updated on 1 product')).toBe(true)
  })

  it('asks "change all" or "make a copy" for a chart on several products, and a copy leaves the original alone', async () => {
    const { renderer, calls } = await openEditor('sc-tops', { 'mutation SaveSizeChart': () => ({ saveSizeChart: { id: 'sc-copy', revision: 1 } }) })

    expect(hasText(renderer, 'This chart is on 24 products. Changes show on all of them.')).toBe(true)
    await type(renderer, 'M, Chest', '97')
    await press(pressableNamed(renderer, 'Save chart'))
    expect(hasText(renderer, 'This changes the chart on 24 products')).toBe(true)
    expect(asked(calls, 'mutation SaveSizeChart')).toHaveLength(0)
    await press(pressableNamed(renderer, 'Make a copy instead'))
    await press(pressableNamed(renderer, 'Continue'))
    await settle()

    expect(asked(calls, 'mutation SaveSizeChart')[0]?.variables).toMatchObject({ id: null, revision: null, input: { name: 'Tops & shirts (copy)' } })
    expect(hasText(renderer, 'Copy made — it isn’t on any products yet')).toBe(true)
    expect(mockReplace).toHaveBeenCalledWith('/catalogue/size-charts/sc-copy')
  })

  it('names what the API would refuse before sending, and converts units without sending', async () => {
    const { renderer, calls } = await openEditor('sc-tops', { 'sizeChart(id': () => ({ sizeChart: chart({ products: 0 }) }) })

    await press(pressableNamed(renderer, 'in'))
    expect(hasText(renderer, 'Converted to inches')).toBe(true)
    expect((input(renderer, 'M, Chest').props as { value: string }).value).toBe('37.8')
    await type(renderer, 'Chart name', ' ')
    await press(pressableNamed(renderer, 'Save chart'))

    expect(hasText(renderer, 'Give the chart a name')).toBe(true)
    expect(asked(calls, 'mutation SaveSizeChart')).toHaveLength(0)
  })

  it('says how many products lose a deleted chart, before it is deleted', async () => {
    const { renderer, calls } = await openEditor('sc-tops', { 'mutation DeleteSizeChart': () => ({ deleteSizeChart: 24 }) })

    await press(pressableNamed(renderer, 'Delete chart'))
    expect(hasText(renderer, '24 products will lose their size chart. You can pick another chart for them after.')).toBe(true)
    expect(asked(calls, 'mutation DeleteSizeChart')).toHaveLength(0)
    const confirms = pressablesNamed(renderer, 'Delete chart')
    await press(confirms[confirms.length - 1] as (typeof confirms)[number])
    await settle()

    expect(asked(calls, 'mutation DeleteSizeChart')[0]?.variables).toEqual({ id: 'sc-tops' })
    expect(mockBack).toHaveBeenCalled()
  })

  it.each([
    ['TOO_MANY_SIZE_CHARTS', 'You have 200 size charts, the most there can be. Delete one first.'],
    ['STALE_REVISION', 'Someone else saved this chart first. Open it again to see their changes.'],
    ['INVALID_INPUT', 'Something in the chart isn’t valid: up to 60 sizes, 12 measurements, 6 size systems, 20 characters a cell.'],
  ])('shows a refused save (%s) by its code and keeps what was typed', async (code, words) => {
    const { renderer } = await openEditor('sc-tops', {
      'sizeChart(id': () => ({ sizeChart: chart({ products: 0 }) }),
      'mutation SaveSizeChart': () => {
        throw new ApiError(code, 'API words that are never shown')
      },
    })

    await type(renderer, 'M, Chest', '97')
    await press(pressableNamed(renderer, 'Save chart'))
    await settle()

    expect(hasText(renderer, words)).toBe(true)
    expect(hasText(renderer, 'API words that are never shown')).toBe(false)
    expect((input(renderer, 'M, Chest').props as { value: string }).value).toBe('97')
  })

  it('lets Staff look at a chart but not change it', async () => {
    const { renderer } = await openEditor('sc-tops', { 'acting { permissions': () => ({ me: { acting: { permissions: ['catalog.read'], seller: null } } }) }, { acting: actingAs('staff') })

    expect(hasText(renderer, 'You can look at size charts but not change them.')).toBe(true)
    expect((input(renderer, 'M, Chest').props as { editable: boolean }).editable).toBe(false)
    expect(pressablesNamed(renderer, 'Save chart')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Delete chart')).toHaveLength(0)
  })

  it('draws the shell’s 404 for a chart that isn’t here', async () => {
    const { renderer } = await openEditor('gone', { 'sizeChart(id': () => ({ sizeChart: null }) })

    expect(hasText(renderer, 'This page isn’t here any more')).toBe(true)
  })
})
