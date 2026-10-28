import { act, create } from 'react-test-renderer'
import { fakeSession, flush } from '../testing/harness'
import { SessionContext } from '../session/SessionContext'
import { PushProvider } from './PushContext'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
const mockRouter = { push: jest.fn(), navigate: jest.fn() }
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }))
const mockLast = jest.fn()
jest.mock('./sdk', () => ({
  loadNotifications: () => ({
    setNotificationHandler: jest.fn(),
    getLastNotificationResponse: () => mockLast(),
    addNotificationReceivedListener: () => ({ remove: jest.fn() }),
    addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
  }),
}))
jest.mock('./push', () => ({ ...jest.requireActual('./push'), pushIsSetUp: () => true, registerIfGranted: jest.fn().mockResolvedValue(undefined) }))

const tap = (identifier: string, kind: string, deliveryId: string) => ({ notification: { request: { identifier, content: { data: { kind, deliveryId } } } } })
const tree = (signedIn: boolean) => (
  <SessionContext.Provider value={fakeSession(() => ({}), { signedIn })}>
    <PushProvider>{null}</PushProvider>
  </SessionContext.Provider>
)

beforeEach(() => jest.clearAllMocks())

describe('a notification tapped to open the app', () => {
  it('is kept until the rider is signed in, then opens what it names, once', async () => {
    mockLast.mockReturnValue(tap('n-1', 'rider.assigned', 'd-1'))
    let renderer!: ReturnType<typeof create>
    await act(async () => void (renderer = create(tree(false))))
    await flush()
    expect(mockRouter.push).not.toHaveBeenCalled()
    expect(mockRouter.navigate).not.toHaveBeenCalled()

    await act(async () => renderer.update(tree(true)))
    await flush()
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/delivery/[id]', params: { id: 'd-1' } })

    await act(async () => renderer.update(tree(true)))
    await flush()
    expect(mockRouter.push).toHaveBeenCalledTimes(1)
  })

  it('opens at once for a rider who is already signed in', async () => {
    mockLast.mockReturnValue(tap('n-2', 'rider.offer', 'd-2'))
    await act(async () => void create(tree(true)))
    await flush()
    expect(mockRouter.navigate).toHaveBeenCalledWith('/home')
  })
})
