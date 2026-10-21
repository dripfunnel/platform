import { act } from 'react-test-renderer'
import { ApiError } from '../../graphql'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { CollectionEditorScreen } from './CollectionEditorScreen'
import { CollectionsArea } from './CollectionsArea'
import { asked, base, collections, full, input, noRule, paged, pause, readOnlyState, settle, show, type, valueRule, type Handlers, type Options } from './testKit'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockDispatch = jest.fn()
const mockPrevent = jest.fn()

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, navigate: jest.fn() }),
    useNavigation: () => ({ dispatch: mockDispatch }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (...args: unknown[]) => mockPrevent(...args) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => jest.requireActual('./testKit').session.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

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

  it.each([
    ['a seat without the catalogue', [], null],
    ['a supplier’s seat, which has no collections', ['catalog.read', 'catalog.write'], { id: 's-1' }],
  ])('shows access denied, and no form, to %s opening the editor by a link', async (_who, permissions, seller) => {
    const { renderer } = await open('c-summer', editorHandlers({ 'acting { permissions': () => ({ me: { acting: { permissions, seller } } }) }))

    expect(hasText(renderer, 'You don’t have access to Collections')).toBe(true)
    expect(pressablesNamed(renderer, 'Save collection')).toHaveLength(0)
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === 'Name' && typeof node.props.onChangeText === 'function')).toHaveLength(0)
  })

  it('shows it for a new collection too', async () => {
    const { renderer } = await open(null, editorHandlers({ 'acting { permissions': () => ({ me: { acting: { permissions: [], seller: null } } }) }))

    expect(hasText(renderer, 'You don’t have access to Collections')).toBe(true)
  })

  describe('leaving with changes not saved', () => {
    type Guard = [boolean, (event: { data: { action: unknown } }) => void]
    const guard = () => mockPrevent.mock.calls.at(-1) as Guard
    const goBack = (action: unknown) => act(async () => guard()[1]({ data: { action } }))

    it('does not hold the screen back while nothing is changed', async () => {
      await open('c-summer', editorHandlers())

      expect(guard()[0]).toBe(false)
    })

    it('asks first once something is changed, and Keep editing stays where it is', async () => {
      const { renderer } = await open('c-summer', editorHandlers())

      await type(renderer, 'Name', 'Summer 2')
      expect(guard()[0]).toBe(true)
      await goBack({ type: 'GO_BACK' })
      expect(hasText(renderer, 'Leave without saving?')).toBe(true)
      await press(pressableNamed(renderer, 'Keep editing'))
      expect(mockDispatch).not.toHaveBeenCalled()
      expect((input(renderer, 'Name').props as { value: string }).value).toBe('Summer 2')
    })

    it('leaves by the same way it was asked to when Discard changes is chosen', async () => {
      const { renderer } = await open('c-summer', editorHandlers())

      await type(renderer, 'Name', 'Summer 2')
      await goBack({ type: 'GO_BACK' })
      await press(pressableNamed(renderer, 'Discard changes'))

      expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' })
    })

    it('leaves a saved collection without asking, and stops guarding once it has', async () => {
      const { renderer } = await open('c-summer', editorHandlers({ 'mutation SaveCollection': () => ({ saveCollection: { id: 'c-summer', revision: 5 } }) }))

      await type(renderer, 'Name', 'Summer 2')
      await press(pressableNamed(renderer, 'Save collection'))
      await settle()

      expect(mockBack).toHaveBeenCalledTimes(1)
      expect(guard()[0]).toBe(false)
      expect(hasText(renderer, 'Leave without saving?')).toBe(false)
    })
  })

  it('shows a refused delete by its code, keeps the editor open, and leaves nothing deleted', async () => {
    const { renderer } = await open(
      'c-summer',
      editorHandlers({
        'mutation DeleteCollection': () => {
          throw new ApiError('READ_ONLY', 'API words that are never shown')
        },
      }),
    )

    await press(pressableNamed(renderer, 'Delete collection'))
    const confirms = pressablesNamed(renderer, 'Delete collection')
    await press(confirms[confirms.length - 1] as (typeof confirms)[number])
    await settle()

    expect(hasText(renderer, 'Your store is read-only until the bill is paid.')).toBe(true)
    expect(hasText(renderer, 'API words that are never shown')).toBe(false)
    expect(mockBack).not.toHaveBeenCalled()
  })

  it('on a store that is read-only (past due) shows the editor to look at, with nothing to save or delete', async () => {
    const { renderer } = await open('c-summer', editorHandlers(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'You can look at collections but not change them.')).toBe(true)
    expect((input(renderer, 'Name').props as { editable: boolean }).editable).toBe(false)
    expect(pressablesNamed(renderer, 'Save collection')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Delete collection')).toHaveLength(0)
  })

  it('says "if" it is in the menu when the menu could not be read, rather than saying it is or is not', async () => {
    const { renderer } = await open(
      'c-summer',
      editorHandlers({
        '{ menu {': () => {
          throw new ApiError('NO_RESPONSE', 'x')
        },
      }),
    )

    await press(pressableNamed(renderer, 'Delete collection'))

    expect(hasText(renderer, 'If it’s in your menu, we’ll take it out and move anything nested under it up a level.')).toBe(true)
    expect(hasText(renderer, 'It’s in your menu too')).toBe(false)
  })
})
