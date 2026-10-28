import { Linking, Text } from 'react-native'
import { t } from '../messages'
import { fakeSession, hasButton, hasText, press, render } from '../testing/harness'
import { installedBuild } from './installedBuild'
import { UpdateGate } from './UpdateGate'

jest.mock('./installedBuild', () => ({ installedBuild: jest.fn() }))
const mockInstalled = jest.mocked(installedBuild)
const mockOpen = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)

const app = <UpdateGate><Text>Home screen</Text></UpdateGate>
const answering = (minimumBuild: number | null) => fakeSession(() => ({ minimumBuild }))

// The first render loads react-native's lazy modules cold, over 30 s on a loaded CI runner (as HomeScreen.test.tsx), so it is paid once, here.
beforeAll(async () => {
  mockInstalled.mockReturnValue(1)
  await render(app, answering(null))
}, 120_000)

beforeEach(() => mockOpen.mockClear())

describe('the update gate', () => {
  it('asks the Delivery API for the minimum build without a sign-in', async () => {
    mockInstalled.mockReturnValue(5)
    const session = fakeSession(() => ({ minimumBuild: 3 }), { signedIn: false })
    await render(app, session)
    expect(session.requests.map((r) => r.query)).toEqual(['{ minimumBuild }'])
  })

  it('shows Update required instead of the app for a build below the minimum, with the download of the store’s APK', async () => {
    mockInstalled.mockReturnValue(2)
    const screen = await render(app, answering(3))
    expect(hasText(screen, t('update.title'))).toBe(true)
    expect(hasText(screen, 'Home screen')).toBe(false)
    await press(screen, t('update.download'))
    expect(mockOpen).toHaveBeenCalledWith('https://acme.my-store.one/app/delivery.apk')
  })

  it('lets a build at or above the minimum run', async () => {
    mockInstalled.mockReturnValue(3)
    const screen = await render(app, answering(3))
    expect(hasText(screen, 'Home screen')).toBe(true)
    expect(hasButton(screen, t('update.download'))).toBe(false)
  })

  it('lets the app run when no minimum is set, the build is unknown, or the API does not answer', async () => {
    mockInstalled.mockReturnValue(1)
    expect(hasText(await render(app, answering(null)), 'Home screen')).toBe(true)
    mockInstalled.mockReturnValue(null)
    expect(hasText(await render(app, answering(9)), 'Home screen')).toBe(true)
    mockInstalled.mockReturnValue(1)
    const failing = fakeSession(() => {
      throw new Error('offline')
    })
    expect(hasText(await render(app, failing), 'Home screen')).toBe(true)
  })
})
