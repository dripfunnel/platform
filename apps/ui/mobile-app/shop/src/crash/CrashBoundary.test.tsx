import { useState } from 'react'
import { Text } from 'react-native'
import { act } from 'react-test-renderer'
import { t } from '../messages'
import { fakeShop, hasText, press, render } from '../testing/harness'
import { CrashBoundary } from './CrashBoundary'

// A screen that throws is reported and replaced by a message that can be tried again (card #876).

jest.setTimeout(120_000)

const mockReport = jest.fn()
jest.mock('@dripfunnel/mobile-shared/crash', () => ({ reportError: (error: unknown) => mockReport(error) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

let broken = true
function Screen() {
  const [, set] = useState(0)
  void set
  if (broken) throw new Error('Sam Rao ordered 2 for sam@example.com')
  return <Text>The shop</Text>
}

beforeEach(() => {
  mockReport.mockClear()
  broken = true
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('the crash boundary', () => {
  it('reports the error that stopped a screen, and shows a message that does not repeat it', async () => {
    const screen = await render(
      <CrashBoundary>
        <Screen />
      </CrashBoundary>,
      fakeShop(() => ({})),
    )
    expect(mockReport).toHaveBeenCalledTimes(1)
    expect(hasText(screen, t('crash.title'))).toBe(true)
    expect(hasText(screen, t('crash.body'))).toBe(true)
    expect(hasText(screen, 'sam@example.com')).toBe(false)
  })

  it('shows the screen again when it is tried again and the fault has gone', async () => {
    const screen = await render(
      <CrashBoundary>
        <Screen />
      </CrashBoundary>,
      fakeShop(() => ({})),
    )
    broken = false
    await press(screen, t('states.retry'))
    expect(hasText(screen, 'The shop')).toBe(true)
    await act(async () => undefined)
  })

  it('shows the screen and reports nothing while it works', async () => {
    broken = false
    const screen = await render(
      <CrashBoundary>
        <Screen />
      </CrashBoundary>,
      fakeShop(() => ({})),
    )
    expect(hasText(screen, 'The shop')).toBe(true)
    expect(mockReport).not.toHaveBeenCalled()
  })
})
