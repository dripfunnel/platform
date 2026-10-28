import { useEffect, useState } from 'react'
import { Text } from 'react-native'
import { act } from 'react-test-renderer'
import { t } from '../../messages'
import { fakeShop, hasText, isDisabled, pressableNamed, render } from '../../testing/harness'
import { Button } from '../common/ui'
import { OfflineStrip } from './OfflineStrip'

jest.setTimeout(120_000)

jest.mock('react-native-safe-area-context', () => {
  const { createContext, useContext } = jest.requireActual<typeof import('react')>('react')
  const SafeAreaInsetsContext = createContext<{ top: number } | null>(null)
  return { SafeAreaInsetsContext, useSafeAreaInsets: () => useContext(SafeAreaInsetsContext) ?? { top: 24, bottom: 0, left: 0, right: 0 } }
})
type NetState = { isConnected: boolean | null; isInternetReachable: boolean | null }
const mockNet: { listener: ((state: NetState) => void) | null } = { listener: null }
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: NetState) => void) => {
      mockNet.listener = listener
      return () => undefined
    },
  },
}))

const go = (state: NetState) => act(async () => mockNet.listener?.(state))
const offline = () => go({ isConnected: false, isInternetReachable: false })
const online = () => go({ isConnected: true, isInternetReachable: true })

// Counts how often the screen below the banner is started, to show the banner coming and going does not start it over.
let mounts = 0
function Draft() {
  const [typed] = useState('draft')
  useEffect(() => {
    mounts += 1
  }, [])
  return <Text>{typed}</Text>
}

const onPress = jest.fn()
const show = () =>
  render(
    <OfflineStrip>
      <Draft />
      <Button saves label="Place order" onPress={onPress} />
      <Button label="Back" onPress={onPress} />
    </OfflineStrip>,
    fakeShop(() => ({})),
  )

beforeEach(async () => {
  mounts = 0
  onPress.mockClear()
  if (mockNet.listener) await online()
})

describe('the offline banner', () => {
  it('is not shown while the phone is online', async () => {
    const view = await show()
    expect(hasText(view, t('states.offline.strip'))).toBe(false)
  })

  it('shows on the screen while the phone is offline and goes when it is back, without starting the screen over', async () => {
    const view = await show()
    await offline()
    expect(hasText(view, t('states.offline.strip'))).toBe(true)
    expect(view.root.findAll((node) => node.props.accessibilityRole === 'alert').length).toBeGreaterThan(0)
    await online()
    expect(hasText(view, t('states.offline.strip'))).toBe(false)
    expect(mounts).toBe(1)
  })

  it('takes a connection state the phone has not worked out yet to mean online', async () => {
    const view = await show()
    await go({ isConnected: null, isInternetReachable: null })
    expect(hasText(view, t('states.offline.strip'))).toBe(false)
  })
})

describe('writes while offline', () => {
  it('are off, with the reason for a screen reader, on a button that saves, and nothing else is', async () => {
    const view = await show()
    await offline()
    const saves = pressableNamed(view, 'Place order')
    expect(isDisabled(saves)).toBe(true)
    expect(saves.props.accessibilityHint).toBe(t('states.offline.writes'))
    expect(isDisabled(pressableNamed(view, 'Back'))).toBe(false)
    await online()
    expect(isDisabled(pressableNamed(view, 'Place order'))).toBe(false)
  })
})
