import { act, create } from 'react-test-renderer'
import type { SessionState } from '../session'
import { CrashEffects } from './CrashEffects'

// Collection starts, and reports know the person and the acting store by their opaque ids only (card #878).

jest.setTimeout(120_000)

const mockSetup = { on: true }
const mockStart = jest.fn()
const mockUser = jest.fn()
const mockStore = jest.fn()
jest.mock('@dripfunnel/mobile-shared/crash', () => ({
  crashReportingIsSetUp: () => mockSetup.on,
  startReporting: () => mockStart(),
  setReportingUser: (id: string | null) => mockUser(id),
  setReportingStore: (id: string | null) => mockStore(id),
}))

const mockSession: { state: SessionState } = { state: { status: 'signedOut', notice: null } }
const mockRequest = jest.fn()
jest.mock('../session', () => ({ useSession: () => mockSession.state, sessionClient: () => ({ request: (query: string) => mockRequest(query) }) }))

const signedIn = (storeId: string | null): SessionState => ({
  status: 'signedIn',
  token: 'secret-token',
  acting: storeId ? { storeId, supplierId: null, storeName: 'Juniper & Co.', role: 'owner', tier: null } : null,
  last: null,
})

const mount = async () => {
  await act(async () => {
    create(<CrashEffects />)
  })
}

beforeEach(() => {
  mockSetup.on = true
  mockSession.state = { status: 'signedOut', notice: null }
  for (const mock of [mockStart, mockUser, mockStore, mockRequest]) mock.mockReset()
  mockRequest.mockResolvedValue({ me: { id: 'u-4c1', name: 'Farhan Ali', email: 'farhan@example.com' } })
})

describe('crash reporting’s effects', () => {
  it('start collection, and give reports the person’s id and the acting store’s id and nothing else of either', async () => {
    mockSession.state = signedIn('store-7a1')
    await mount()
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(mockRequest).toHaveBeenCalledWith('{ me { id } }')
    expect(mockUser).toHaveBeenCalledWith('u-4c1')
    expect(mockStore).toHaveBeenCalledWith('store-7a1')
    expect(JSON.stringify([...mockUser.mock.calls, ...mockStore.mock.calls])).not.toMatch(/Farhan|example\.com|Juniper|secret-token/)
  })

  it('give no store while none is acting, and no person or store when signed out, asking the API for nothing', async () => {
    await mount()
    expect(mockUser).toHaveBeenCalledWith(null)
    expect(mockStore).toHaveBeenCalledWith(null)
    expect(mockRequest).not.toHaveBeenCalled()

    mockStore.mockClear()
    mockSession.state = signedIn(null)
    await mount()
    expect(mockStore).toHaveBeenCalledWith(null)
  })

  it('stay out of a build with no Firebase files: no read of the person, no id', async () => {
    mockSetup.on = false
    mockSession.state = signedIn('store-7a1')
    await mount()
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockUser).not.toHaveBeenCalled()
  })

  it('give no id for a person the API has no id for, and none for a read that fails', async () => {
    mockSession.state = signedIn('store-7a1')
    mockRequest.mockResolvedValue({ me: null })
    await mount()
    expect(mockUser).toHaveBeenLastCalledWith(null)
    mockUser.mockClear()
    mockRequest.mockRejectedValue(new Error('down'))
    await mount()
    expect(mockUser).not.toHaveBeenCalled()
  })
})
