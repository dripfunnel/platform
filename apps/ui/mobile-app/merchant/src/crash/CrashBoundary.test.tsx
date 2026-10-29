import { Text } from 'react-native'
import { t } from '../messages'
import { hasText, press, pressableNamed, renderShell } from '../testing/harness'
import { CrashBoundary } from './CrashBoundary'

// A screen that throws is reported and replaced by a message that can be tried again (card #878).

jest.setTimeout(120_000)

const mockReport = jest.fn()
jest.mock('@dripfunnel/mobile-shared/crash', () => ({ reportError: (error: unknown) => mockReport(error) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))

let broken = true
function Screen() {
  if (broken) throw new Error('Farhan Ali ordered 2 for farhan@example.com')
  return <Text>The store</Text>
}

const boundary = () => (
  <CrashBoundary>
    <Screen />
  </CrashBoundary>
)

beforeEach(() => {
  mockReport.mockClear()
  broken = true
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('the crash boundary', () => {
  it('reports the error that stopped a screen, and shows a message that does not repeat it', async () => {
    const screen = await renderShell(boundary())
    expect(mockReport).toHaveBeenCalledTimes(1)
    expect(hasText(screen, t('crash.title'))).toBe(true)
    expect(hasText(screen, t('crash.body'))).toBe(true)
    expect(hasText(screen, 'farhan@example.com')).toBe(false)
  })

  it('shows the screen again when it is tried again and the fault has gone', async () => {
    const screen = await renderShell(boundary())
    broken = false
    await press(pressableNamed(screen, t('common.tryAgain')))
    expect(hasText(screen, 'The store')).toBe(true)
  })

  it('shows the screen and reports nothing while it works', async () => {
    broken = false
    const screen = await renderShell(boundary())
    expect(hasText(screen, 'The store')).toBe(true)
    expect(mockReport).not.toHaveBeenCalled()
  })
})
