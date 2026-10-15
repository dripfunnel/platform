import { Text } from 'react-native'
import { act } from 'react-test-renderer'
import { actingAs, byRole, hasText, press, pressableNamed, renderShell, texts } from '../../testing/harness'
import { BottomSheet } from '../shell/BottomSheet'
import { getScenario, resetScenario, setScenario, type ScreenState } from './scenario'
import { ScenarioMenu } from './ScenarioMenu'
import { ShellScreen } from './ShellScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockNavigate = jest.fn()
const mockLeaveStore = jest.fn()
const mockEnd = jest.fn(() => Promise.resolve())

jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate, push: jest.fn(), back: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('../../session', () => ({ session: () => ({ leaveStore: mockLeaveStore, end: mockEnd }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

const screen = (kind: ScreenState, label = 'Orders') => {
  setScenario({ screen: kind })
  return renderShell(
    <ShellScreen label={label}>
      <Text>the real screen</Text>
    </ShellScreen>,
  )
}

describe('the designed states (DESIGN.md §4)', () => {
  it('draws the real screen when nothing is wrong', async () => {
    expect(hasText(await screen('normal'), 'the real screen')).toBe(true)
  })

  it('draws a skeleton, and says so, while a page is slow', async () => {
    const renderer = await screen('slow')
    expect(hasText(renderer, 'the real screen')).toBe(false)
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === 'Loading').length).toBeGreaterThan(0)
    expect(hasText(renderer, 'This is taking longer than usual.')).toBe(true)
  })

  it('says a page could not load, that nothing is lost, and gives a reference to quote', async () => {
    const renderer = await screen('loadErr', 'Orders')
    expect(hasText(renderer, 'We couldn’t load Orders')).toBe(true)
    expect(hasText(renderer, 'Nothing is lost')).toBe(true)
    expect(hasText(renderer, 'Ref 503 · p-4821 — quote this if you contact support')).toBe(true)
    await press(pressableNamed(renderer, 'Try again'))
    expect(getScenario().screen).toBe('normal')
  })

  it('says a page is gone, and goes Home', async () => {
    const renderer = await screen('notFound')
    expect(hasText(renderer, 'This page isn’t here any more')).toBe(true)
    await press(pressableNamed(renderer, 'Go to Home'))
    expect(mockNavigate).toHaveBeenCalledWith('/home')
  })

  it('says a role may not open a screen, and for a supplier names the store to ask', async () => {
    expect(hasText(await screen('denied', 'Settings'), 'You don’t have access to Settings')).toBe(true)
    await act(async () => setScenario({ screen: 'denied', role: 'supplierStock' }))
    const supplier = await renderShell(<ShellScreen label="Reports">{null}</ShellScreen>, { acting: actingAs('supplier-member', 'vendor-stock') })
    expect(hasText(supplier, 'Ask Juniper & Co. if you need it.')).toBe(true)
    await press(pressableNamed(supplier, 'Go to Home'))
    expect(mockNavigate).toHaveBeenCalledWith('/products')
  })

  it('says the session expired, and ends it so the sign-in screen shows its note', async () => {
    const renderer = await screen('expired')
    expect(hasText(renderer, 'You were signed out after a while without activity.')).toBe(true)
    await press(pressableNamed(renderer, 'Sign in'))
    expect(mockEnd).toHaveBeenCalledWith('expired')
  })

  it('says a person was removed from the store, and offers the chooser', async () => {
    const renderer = await screen('removed')
    expect(hasText(renderer, 'You no longer have access to Juniper & Co.')).toBe(true)
    await press(pressableNamed(renderer, 'Switch store'))
    expect(mockLeaveStore).toHaveBeenCalledTimes(1)
  })

  it('says the phone is offline, and keeps the data it has', async () => {
    const renderer = await screen('offline')
    expect(hasText(renderer, 'You’re offline.')).toBe(true)
    expect(hasText(renderer, 'changes need a connection')).toBe(true)
  })

  it('draws a state a screen knows by itself, without the Scenario menu', async () => {
    const renderer = await renderShell(
      <ShellScreen label="Reports" state="denied">
        <Text>the real screen</Text>
      </ShellScreen>,
    )
    expect(hasText(renderer, 'You don’t have access to Reports')).toBe(true)
    expect(hasText(renderer, 'the real screen')).toBe(false)
  })
})

describe('the Scenario menu', () => {
  it('changes what the shell draws, and resets', async () => {
    const renderer = await renderShell(<ScenarioMenu />)
    await press(pressableNamed(renderer, 'Scenario'))
    await press(pressableNamed(renderer, 'Supplier: stock'))
    await press(pressableNamed(renderer, 'Past due'))
    await press(pressableNamed(renderer, 'Dark'))
    expect(getScenario()).toMatchObject({ role: 'supplierStock', banner: 'pastDue', mode: 'dark' })
    await press(pressableNamed(renderer, 'Reset'))
    expect(getScenario()).toMatchObject({ screen: 'normal', banner: 'real', role: 'real', mode: 'real' })
  })

  it('can never put a store build into a scenario', async () => {
    const dev = __DEV__
    Object.assign(globalThis, { __DEV__: false })
    try {
      setScenario({ screen: 'loadErr', role: 'staff' })
      expect(getScenario()).toMatchObject({ screen: 'normal', role: 'real' })
      const renderer = await renderShell(<ScenarioMenu />)
      expect(byRole(renderer, 'button')).toHaveLength(0)
    } finally {
      Object.assign(globalThis, { __DEV__: dev })
    }
  })
})

describe('the bottom sheet (DESIGN.md §4)', () => {
  it('puts the confirm button above Cancel, and runs the action once on confirm', async () => {
    const onConfirm = jest.fn()
    const onClose = jest.fn()
    const renderer = await renderShell(<BottomSheet spec={{ title: 'Delete it?', body: 'It can’t be undone.', confirm: 'Delete', danger: true, onConfirm }} onClose={onClose} />)
    const words = texts(renderer)
    expect(words).toContain('Delete it?')
    expect(words.indexOf('Delete')).toBeGreaterThanOrEqual(0)
    expect(words.indexOf('Delete')).toBeLessThan(words.indexOf('Cancel'))
    await press(pressableNamed(renderer, 'Delete'))
    expect(onConfirm).toHaveBeenCalledWith({ choice: null, text: '' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('asks for the one thing it needs before confirming, and passes the choice on', async () => {
    const onConfirm = jest.fn()
    const spec = { title: 'Cancel order', choices: [{ value: 'a', label: 'Customer asked' }, { value: 'b', label: 'Out of stock' }], input: { label: 'Note', error: 'Add a note.' }, confirm: 'Cancel order', onConfirm }
    const renderer = await renderShell(<BottomSheet spec={spec} onClose={jest.fn()} />)
    await press(pressableNamed(renderer, 'Cancel order'))
    expect(hasText(renderer, 'Add a note.')).toBe(true)
    expect(onConfirm).not.toHaveBeenCalled()
    await press(pressableNamed(renderer, 'Out of stock'))
    await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Note' }).props.onChangeText('Sold out'))
    await press(pressableNamed(renderer, 'Cancel order'))
    expect(onConfirm).toHaveBeenCalledWith({ choice: 'b', text: 'Sold out' })
  })
})
