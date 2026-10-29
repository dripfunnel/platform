import { fakeSession, render } from '../testing/harness'
import { CrashEffects } from './CrashEffects'

// Collection starts, and the rider is known to reports by their opaque id only (card #872).

const mockSetup = { on: true }
const mockStart = jest.fn()
const mockUser = jest.fn()
jest.mock('@dripfunnel/mobile-shared/crash', () => ({
  crashReportingIsSetUp: () => mockSetup.on,
  startReporting: () => mockStart(),
  setReportingUser: (id: string | null) => mockUser(id),
}))

// The first render loads react-native's lazy modules cold, over 30 s on a loaded CI runner (as HomeScreen.test.tsx), so it is paid once, here.
beforeAll(async () => {
  await render(<CrashEffects />, fakeSession(() => ({})))
}, 120_000)

beforeEach(() => {
  mockSetup.on = true
  mockStart.mockClear()
  mockUser.mockClear()
})

describe('crash reporting’s effects', () => {
  it('start collection, and give a signed-in rider’s id and nothing else of them', async () => {
    const session = fakeSession(() => ({ me: { id: 'r-41c', name: 'Sam Rao', phone: '+91 98765 43210', vehicleNumber: 'KA 01 AB 1234' } }))
    await render(<CrashEffects />, session)
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(session.requests.map((r) => r.query)).toEqual(['{ me { id } }'])
    expect(mockUser).toHaveBeenCalledWith('r-41c')
    expect(JSON.stringify(mockUser.mock.calls)).not.toMatch(/Sam|98765|KA 01/)
  })

  it('give a signed-out rider no id, and ask the API for nothing', async () => {
    const session = fakeSession(() => ({}), { signedIn: false })
    await render(<CrashEffects />, session)
    expect(mockUser).toHaveBeenCalledWith(null)
    expect(session.requests).toEqual([])
  })

  it('stay out of a build with no Firebase file: no read, no id', async () => {
    mockSetup.on = false
    const session = fakeSession(() => ({ me: { id: 'r-41c' } }))
    await render(<CrashEffects />, session)
    expect(session.requests).toEqual([])
    expect(mockUser).not.toHaveBeenCalled()
  })

  it('give no id for a rider the API has none for, and none for a read that fails', async () => {
    await render(<CrashEffects />, fakeSession(() => ({ me: null })))
    expect(mockUser).toHaveBeenLastCalledWith(null)
    mockUser.mockClear()
    await render(<CrashEffects />, fakeSession(() => Promise.reject(new Error('down'))))
    expect(mockUser).not.toHaveBeenCalled()
  })
})
