import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { reportError, setReportingUser, startReporting } from './report'

// The reporting wrapper (card #876), with Firebase stood in for: what it sends, and that a build without the files sends nothing.

const mockSetup = { on: true }
jest.mock('./config', () => ({ crashReportingIsSetUp: () => mockSetup.on }))

const mockSent = { enabled: [] as boolean[], errors: [] as Error[], users: [] as string[] }
jest.mock('./sdk', () => ({
  loadCrashlytics: () => ({
    getCrashlytics: () => ({}),
    setCrashlyticsCollectionEnabled: async (_: unknown, on: boolean) => void mockSent.enabled.push(on),
    recordError: (_: unknown, error: Error) => void mockSent.errors.push(error),
    setUserId: async (_: unknown, id: string) => void mockSent.users.push(id),
  }),
}))

type Handler = (error: unknown, fatal?: boolean) => void
let handler: Handler = () => undefined
const chained: Error[] = []
beforeEach(() => {
  mockSent.enabled.length = mockSent.errors.length = mockSent.users.length = chained.length = 0
  mockSetup.on = true
  handler = (error) => void chained.push(error as Error)
  ;(globalThis as unknown as { ErrorUtils: unknown }).ErrorUtils = { getGlobalHandler: () => handler, setGlobalHandler: (next: Handler) => void (handler = next) }
})

describe('crash reports', () => {
  it('send nothing, and touch no Firebase, for a build without its store’s files', () => {
    mockSetup.on = false
    startReporting()
    reportError(new Error('boom'))
    setReportingUser('c-1')
    expect(mockSent).toEqual({ enabled: [], errors: [], users: [] })
  })

  it('switch collection on once, and clean an uncaught error before Crashlytics’ own handler records it', () => {
    startReporting()
    startReporting()
    expect(mockSent.enabled).toEqual([true])
    handler(new ApiError('SIGNED_OUT', 'Ana Rao, ana@example.com, signed out'), true)
    expect(chained).toHaveLength(1)
    expect(chained[0]?.message).toBe('SIGNED_OUT')
  })

  it('record a caught error by its code or class only', () => {
    reportError(new ApiError('NO_RESPONSE', 'No connection for +91 98765 43210'))
    reportError(new RangeError('4000 is past ₹1,299.00'))
    expect(mockSent.errors.map((e) => e.message)).toEqual(['NO_RESPONSE', 'RangeError'])
  })

  it('know the customer by an opaque id when signed in, and by none as a guest', () => {
    setReportingUser('c-9f2')
    setReportingUser(null)
    expect(mockSent.users).toEqual(['c-9f2', ''])
  })
})
