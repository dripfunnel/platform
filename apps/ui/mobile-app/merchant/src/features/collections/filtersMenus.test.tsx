import { act } from 'react-test-renderer'
import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { actingAs, hasText, press, pressableNamed, pressablesNamed, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { CollectionsArea } from './CollectionsArea'
import { asked, base, paged, settle, show, tab, type Handlers, type Options } from './testKit'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()

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
jest.mock('../../session', () => ({ sessionClient: () => jest.requireActual('./testKit').session.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
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

    await press(pressableNamed(renderer, 'Linen, 9 products'))
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

    await press(pressableNamed(renderer, 'Wedding, 4 products'))
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
    expect(hasText(renderer, 'Products using “Off white” will use “Off-white” instead.')).toBe(true)
    await press(pressableNamed(renderer, 'Merge'))
    await settle()

    expect(asked(calls, 'mutation MergeValues')[0]?.variables).toEqual({ into: 'off-white', from: ['off white'] })
  })

  it('names a value with how many products use it, so a screen reader hears a count of products and not a bare number', async () => {
    const { renderer } = await open()

    expect(pressablesNamed(renderer, 'Linen, 9 products')).toHaveLength(1)
    expect(pressablesNamed(renderer, 'Yes, 2 products')).toHaveLength(1)
  })

  it('never offers to merge values made only of symbols, which have no letters to compare', async () => {
    const symbols = { id: 'f-sizes', name: 'Sizes', position: 0, revision: 1, shopperVisible: true, values: [{ id: 'plus', name: '+', products: 3 }, { id: 'slash', name: '/', products: 1 }] }
    const { renderer } = await open({ 'facets(first': () => ({ facets: paged([symbols]) }) })

    expect(hasText(renderer, 'look like the same thing')).toBe(false)
    expect(pressablesNamed(renderer, 'Merge them')).toHaveLength(0)
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

  it('says someone else changed the filter first when its revision was stale, and reads the filters again', async () => {
    const { renderer, calls } = await open({
      'mutation SaveFilter': () => {
        throw new ApiError('STALE_REVISION', 'x')
      },
    })
    const before = asked(calls, 'facets(first').length

    await press(pressableNamed(renderer, 'Fabric: shoppers see this. Make it internal'))
    await press(pressableNamed(renderer, 'Make internal'))
    await settle()

    expect(hasText(renderer, 'Someone else changed this filter first. It now shows their changes; make yours again.')).toBe(true)
    expect(asked(calls, 'facets(first').length).toBeGreaterThan(before)
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

  it('lets Staff look at the menu but not change it: no Add, and the rows do nothing', async () => {
    const { renderer } = await open({ 'acting { permissions': () => ({ me: { acting: { permissions: ['catalog.read'], seller: null } } }) }, { acting: actingAs('staff') })

    expect(hasText(renderer, 'You can look at the menu but not change it.')).toBe(true)
    expect(pressablesNamed(renderer, '+ Add a collection')).toHaveLength(0)
    const row = renderer.root.findAll((node) => node.props.accessibilityLabel === 'Summer edit, 18 products' && node.props.disabled !== undefined)[0]
    expect((row?.props as { disabled: boolean }).disabled).toBe(true)
  })

  it('says the menu did not load, and reads it again on request', async () => {
    let fail = true
    const { renderer, calls } = await open({
      '{ menu {': () => {
        if (fail) throw new ApiError('NO_RESPONSE', 'x')
        return menu()
      },
    })

    expect(hasText(renderer, 'Your menu didn’t load')).toBe(true)
    fail = false
    await press(pressableNamed(renderer, 'Try again'))
    await settle()
    expect(asked(calls, '{ menu {').length).toBeGreaterThan(1)
    expect(hasText(renderer, 'Summer edit')).toBe(true)
  })
})

describe('the tab bar', () => {
  it('is not drawn for a seat that may not open Collections, which sees the access-denied view alone', async () => {
    const { renderer } = await show(<CollectionsArea />, { ...base(), 'acting { permissions': () => ({ me: { acting: { permissions: [], seller: null } } }) })

    expect(hasText(renderer, 'You don’t have access to Collections')).toBe(true)
    expect(pressablesNamed(renderer, 'Filters')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Menus')).toHaveLength(0)
  })

  it('is drawn for a seat that may', async () => {
    const { renderer } = await show(<CollectionsArea />, base())

    expect(pressablesNamed(renderer, 'Filters')).toHaveLength(1)
  })
})
