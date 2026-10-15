import { Pressable, Text } from 'react-native'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { press, pressableNamed, renderShell } from '../../testing/harness'
import type { SheetSpec } from './BottomSheet'
import { useFeedback } from './Feedback'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

type NetState = { isConnected: boolean | null; isInternetReachable: boolean | null }
const mockNetListeners: ((state: NetState) => void)[] = []

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('../../session', () => ({ session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: (listener: (state: NetState) => void) => (mockNetListeners.push(listener), () => undefined) } }))

function Opener({ spec }: { spec: SheetSpec }) {
  const feedback = useFeedback()
  return (
    <Pressable accessibilityLabel="open" onPress={() => feedback.sheet(spec)}>
      <Text>open</Text>
    </Pressable>
  )
}

const goOffline = () => act(async () => mockNetListeners.forEach((listener) => listener({ isConnected: false, isInternetReachable: false })))
const goOnline = () => act(async () => mockNetListeners.forEach((listener) => listener({ isConnected: true, isInternetReachable: null })))
// The button that draws a label, found by its text: the one that carries the disabled state.
const buttonOf = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAll((node) => node.props.accessibilityRole === 'button' && node.findAll((inner) => (inner.type as unknown) === 'Text' && inner.children.join('') === label).length > 0)[0] as ReactTestInstance
const off = (renderer: ReactTestRenderer, label: string) => (buttonOf(renderer, label).props as { accessibilityState: { disabled: boolean } }).accessibilityState.disabled

afterEach(goOnline)

describe('the bottom sheet’s options', () => {
  it('turns a writing confirm off while offline, a dangerous one too, and never runs it', async () => {
    const onConfirm = jest.fn()
    const renderer = await renderShell(<Opener spec={{ title: 'Delete it?', confirm: 'Delete', danger: true, saves: true, onConfirm }} />)
    await press(pressableNamed(renderer, 'open'))
    expect(off(renderer, 'Delete')).toBe(false)

    await goOffline()
    expect(off(renderer, 'Delete')).toBe(true)
    expect(onConfirm).not.toHaveBeenCalled()

    await goOnline()
    expect(off(renderer, 'Delete')).toBe(false)
    await press(buttonOf(renderer, 'Delete'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('turns an ordinary writing confirm off while offline, and leaves one that does not write on', async () => {
    const writes = await renderShell(<Opener spec={{ title: 'Add', confirm: 'Add value', saves: true, onConfirm: jest.fn() }} />)
    await press(pressableNamed(writes, 'open'))
    const reads = await renderShell(<Opener spec={{ title: 'Look', confirm: 'Open it', onConfirm: jest.fn() }} />)
    await press(pressableNamed(reads, 'open'))

    await goOffline()
    expect(off(writes, 'Add value')).toBe(true)
    expect(off(reads, 'Open it')).toBe(false)
  })
})
