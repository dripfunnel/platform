import { useState } from 'react'
import { Text } from 'react-native'
import { act } from 'react-test-renderer'
import { t } from '../messages'
import { fakeSession, hasText, press, render } from '../testing/harness'
import { CrashBoundary } from './CrashBoundary'

// A screen that throws is reported and replaced by a message that can be tried again (card #872).

const mockReport = jest.fn()
jest.mock('@dripfunnel/mobile-shared/crash', () => ({ reportError: (error: unknown) => mockReport(error) }))

let broken = true
function Screen() {
  const [, set] = useState(0)
  void set
  if (broken) throw new Error('Delivering to Sam Rao, +91 98765 43210')
  return <Text>The delivery</Text>
}

// The first render loads react-native's lazy modules cold, over 30 s on a loaded CI runner (as HomeScreen.test.tsx), so it is paid once, here.
beforeAll(async () => {
  broken = false
  await render(<CrashBoundary><Screen /></CrashBoundary>, fakeSession(() => ({})))
}, 120_000)

beforeEach(() => {
  mockReport.mockClear()
  broken = true
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('the crash boundary', () => {
  it('reports the error that stopped a screen, and shows a message that does not repeat it', async () => {
    const screen = await render(<CrashBoundary><Screen /></CrashBoundary>, fakeSession(() => ({})))
    expect(mockReport).toHaveBeenCalledTimes(1)
    expect(hasText(screen, t('crash.title'))).toBe(true)
    expect(hasText(screen, t('crash.body'))).toBe(true)
    expect(hasText(screen, '98765')).toBe(false)
  })

  it('shows the screen again when it is tried again and the fault has gone', async () => {
    const screen = await render(<CrashBoundary><Screen /></CrashBoundary>, fakeSession(() => ({})))
    broken = false
    await press(screen, t('common.retry'))
    expect(hasText(screen, 'The delivery')).toBe(true)
    await act(async () => undefined)
  })

  it('shows the screen and reports nothing while it works', async () => {
    broken = false
    const screen = await render(<CrashBoundary><Screen /></CrashBoundary>, fakeSession(() => ({})))
    expect(hasText(screen, 'The delivery')).toBe(true)
    expect(mockReport).not.toHaveBeenCalled()
  })
})
