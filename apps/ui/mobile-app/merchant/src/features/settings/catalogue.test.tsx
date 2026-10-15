import type { ReactElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, hasText, press, pressableNamed, pressablesNamed, renderShell } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { SettingsTabScreen } from './SettingsTabScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
    useNavigation: () => ({ dispatch: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }))
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(), requestCameraPermissionsAsync: async () => ({ granted: true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../products/files', () => ({ fileDeps: () => ({ domain: 'shop.test', headers: () => ({ authorization: 'Bearer token' }) }) }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>
type Options = Parameters<typeof renderShell>[1]

const show = async (element: ReactElement, handlers: Handlers, options: Options = {}) => {
  const { client, calls } = fakeApi(handlers)
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
const click = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressableNamed(renderer, label))
  await settle()
}
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('Settings is the Owner’s', () => {
  it.each(['catalogue'])('opening %s by a deep link as a Manager is access denied, and reads and writes nothing', async (tab) => {
    const { renderer, calls } = await show(<SettingsTabScreen tab={tab} />, {}, { acting: actingAs('manager') })

    expect(hasText(renderer, 'You don’t have access to Settings')).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

const features = [
  { key: 'sizeCharts', enabled: true, inPlan: true },
  { key: 'specs', enabled: false, inPlan: true },
  { key: 'badges', enabled: true, inPlan: true },
  { key: 'aplus', enabled: false, inPlan: false },
]

describe('Catalogue', () => {
  const store = (over: Handlers = {}): Handlers => ({
    '{ catalogueSettings {': () => ({ catalogueSettings: { features, badges: [{ id: 'b1', label: 'New', rule: 'new_30_days', tone: 'ok', position: 0 }, { id: 'b2', label: 'Handmade', rule: 'manual', tone: 'neutral', position: 1 }] } }),
    ...over,
  })

  it('shows each section with its plan, and none a plan lacks can be switched on', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="catalogue" />, store())

    expect(hasText(renderer, 'Big photos and feature blocks · Not in your plan')).toBe(true)
    expect(hasText(renderer, 'Helps shoppers pick the right size · Included in your plan')).toBe(true)
    expect(pressablesNamed(renderer, 'A+ content · Product story')[0]?.props.accessibilityState).toMatchObject({ disabled: true })
    expect(hasText(renderer, 'See plans')).toBe(false)
  })

  it('saves the sections after saying turning one off hides it on every product', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="catalogue" />, store({ 'mutation SaveSections': () => ({ saveCatalogueSettings: [] }) }))

    await click(renderer, 'Specifications')
    await click(renderer, 'Size charts')
    await click(renderer, 'Save sections')
    expect(hasText(renderer, 'Turning a section off hides it on every product.')).toBe(true)
    expect(asked(calls, 'mutation SaveSections')).toHaveLength(0)
    await press(pressablesNamed(renderer, 'Save sections').at(-1) as never)
    await settle()

    const sent = asked(calls, 'mutation SaveSections')[0]?.variables as { f: { key: string; enabled: boolean }[] }
    expect(sent.f).toEqual(expect.arrayContaining([{ key: 'specs', enabled: true }, { key: 'sizeCharts', enabled: false }, { key: 'badges', enabled: true }, { key: 'aplus', enabled: false }]))
  })

  it('switches on the sections a kind of shop wants, to be saved with the rest', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="catalogue" />, store())

    await click(renderer, 'Electronics')

    expect(hasText(renderer, 'Electronics sections switched on — press Save sections to keep them')).toBe(true)
    expect(asked(calls, 'mutation SaveSections')).toHaveLength(0)
  })

  it('adds a badge with its text and rule, and says whether it applies by itself', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="catalogue" />, store({ 'mutation SaveBadge': () => ({ saveBadge: 'b3' }) }))

    await click(renderer, 'Add a badge')
    await type(renderer, 'What it says', 'Few left')
    await click(renderer, 'Only a few left — automatic')
    await click(renderer, 'Save badge')

    expect(asked(calls, 'mutation SaveBadge')[0]?.variables).toEqual({ id: null, input: { label: 'Few left', rule: 'few_left', tone: 'peach', position: 2 } })
    expect(hasText(renderer, '“Few left” added — it applies by itself')).toBe(true)
  })

  it('keeps a badge to 18 characters and needs its text', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="catalogue" />, store())

    await click(renderer, 'Add a badge')
    await click(renderer, 'Save badge')
    expect(hasText(renderer, 'Type the badge text')).toBe(true)
    await type(renderer, 'What it says', 'Hand-woven in Jaipur by artisans')
    await click(renderer, 'Save badge')
    expect(hasText(renderer, 'Keep it to 18 characters')).toBe(true)
    expect(asked(calls, 'mutation SaveBadge')).toHaveLength(0)
  })

  it('edits a badge in place and deletes one after saying it comes off every product', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="catalogue" />, store({ 'mutation SaveBadge': () => ({ saveBadge: 'b2' }), 'mutation DeleteBadge': () => ({ deleteBadge: true }) }))

    await click(renderer, 'Manage “Handmade”')
    await click(renderer, 'Edit')
    await type(renderer, 'What it says', 'Hand made')
    await click(renderer, 'Save badge')
    expect(asked(calls, 'mutation SaveBadge')[0]?.variables).toEqual({ id: 'b2', input: { label: 'Hand made', rule: 'manual', tone: 'neutral', position: 1 } })

    await click(renderer, 'Manage “New”')
    await click(renderer, 'Delete badge')
    expect(hasText(renderer, 'It comes off every product straight away.')).toBe(true)
    await press(pressablesNamed(renderer, 'Delete badge').at(-1) as never)
    await settle()
    expect(asked(calls, 'mutation DeleteBadge')[0]?.variables).toEqual({ id: 'b1' })
  })

  it('shows a refusal by its code', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="catalogue" />, store({ 'mutation SaveBadge': () => { throw new ApiError('DUPLICATE_LABEL', 'x') } }))

    await click(renderer, 'Add a badge')
    await type(renderer, 'What it says', 'New')
    await click(renderer, 'Save badge')

    expect(hasText(renderer, 'Another badge already says that.')).toBe(true)
  })

  it('leaves legal details out: they wait for their API', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="catalogue" />, store())

    expect(hasText(renderer, 'Legal')).toBe(false)
  })
})
