import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { actingAs, hasText, press, pressableNamed, pressablesNamed, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { CollectionsArea } from './CollectionsArea'
import { SizeChartEditorScreen } from './SizeChartEditorScreen'
import { asked, base, input, paged, settle, show, tab, type, type Handlers, type Options } from './testKit'

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

  it.each([
    ['a seat without the catalogue', [], null],
    ['a supplier’s seat, which has no store size charts', ['catalog.read', 'catalog.write'], { id: 's-1' }],
  ])('shows access denied, and no chart, to %s opening one by a link', async (_who, permissions, seller) => {
    const { renderer } = await openEditor('sc-tops', { 'acting { permissions': () => ({ me: { acting: { permissions, seller } } }) })

    expect(hasText(renderer, 'You don’t have access to Size charts')).toBe(true)
    expect(pressablesNamed(renderer, 'Save chart')).toHaveLength(0)
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === 'Chart name' && typeof node.props.onChangeText === 'function')).toHaveLength(0)
  })
})
