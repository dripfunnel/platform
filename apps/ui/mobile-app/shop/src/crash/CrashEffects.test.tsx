import { fakeShop, render } from '../testing/harness'
import { CrashEffects } from './CrashEffects'

// Collection starts, and the customer is known to reports by their opaque id only (card #876).

jest.setTimeout(120_000)

const mockSetup = { on: true }
const mockStart = jest.fn()
const mockUser = jest.fn()
jest.mock('@dripfunnel/mobile-shared/crash', () => ({ crashReportingIsSetUp: () => mockSetup.on, startReporting: () => mockStart(), setReportingUser: (id: string | null) => mockUser(id) }))

beforeEach(() => {
  mockSetup.on = true
  mockStart.mockClear()
  mockUser.mockClear()
})

describe('crash reporting’s effects', () => {
  it('start collection, and give a signed-in customer’s account id and nothing else of them', async () => {
    const shop = fakeShop(() => ({ account: { id: 'c-9f2', name: 'Sam Rao', email: 'sam@example.com', phone: '+91 98765 43210' } }), { signedIn: true })
    await render(<CrashEffects />, shop)
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(shop.requests.map((r) => r.query)).toEqual(['{ account { id } }'])
    expect(mockUser).toHaveBeenCalledWith('c-9f2')
    expect(JSON.stringify(mockUser.mock.calls)).not.toMatch(/Sam|example\.com|98765/)
  })

  it('give a guest no id, and ask the API for nothing', async () => {
    const shop = fakeShop(() => ({}))
    await render(<CrashEffects />, shop)
    expect(mockUser).toHaveBeenCalledWith(null)
    expect(shop.requests).toEqual([])
  })

  it('stay out of a build with no Firebase files: no account read, no id', async () => {
    mockSetup.on = false
    const shop = fakeShop(() => ({ account: { id: 'c-9f2' } }), { signedIn: true })
    await render(<CrashEffects />, shop)
    expect(shop.requests).toEqual([])
    expect(mockUser).not.toHaveBeenCalled()
  })

  it('give no id for an account the API has no id for, and none for a read that fails', async () => {
    await render(<CrashEffects />, fakeShop(() => ({ account: null }), { signedIn: true }))
    expect(mockUser).toHaveBeenLastCalledWith(null)
    mockUser.mockClear()
    await render(<CrashEffects />, fakeShop(() => Promise.reject(new Error('down')), { signedIn: true }))
    expect(mockUser).not.toHaveBeenCalled()
  })
})
