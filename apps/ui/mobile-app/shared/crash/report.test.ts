import { ApiError } from '../graphql'
import { reportError, setReportingStore, setReportingUser, startReporting } from './report'

// The reporting wrapper (cards #876 and #878), with Firebase stood in for: what it sends, and that a build without the files sends nothing.

const mockSetup = { on: true }
jest.mock('./config', () => ({ crashReportingIsSetUp: () => mockSetup.on }))

const mockSent = { enabled: [] as boolean[], errors: [] as Error[], users: [] as string[], attributes: [] as [string, string][] }
const mockOrder: string[] = []
type MockTracking = { allRejections?: boolean; onUnhandled?: (id: number, error: unknown) => void }
const mockTracking: { options: MockTracking | null } = { options: null }
jest.mock('./sdk', () => ({
  loadCrashlytics: () => ({
    getCrashlytics: () => (mockOrder.push('crashlytics'), {}),
    setCrashlyticsCollectionEnabled: async (_: unknown, on: boolean) => void mockSent.enabled.push(on),
    recordError: (_: unknown, error: Error) => void mockSent.errors.push(error),
    setUserId: async (_: unknown, id: string) => void mockSent.users.push(id),
    setAttribute: async (_: unknown, name: string, value: string) => void mockSent.attributes.push([name, value]),
  }),
  loadRejectionTracking: () => ({
    enable: (options: MockTracking) => {
      mockOrder.push('tracking')
      mockTracking.options = options
    },
  }),
}))

type Handler = (error: unknown, fatal?: boolean) => void
let handler: Handler = () => undefined
const chained: Error[] = []
beforeEach(() => {
  mockSent.enabled.length = mockSent.errors.length = mockSent.users.length = mockSent.attributes.length = chained.length = mockOrder.length = 0
  mockTracking.options = null
  mockSetup.on = true
  handler = (error) => void chained.push(error as Error)
  ;(globalThis as unknown as { ErrorUtils: unknown }).ErrorUtils = { getGlobalHandler: () => handler, setGlobalHandler: (next: Handler) => void (handler = next) }
})

// `startReporting` starts once for the life of its module, so a test that needs a start of its own loads a fresh copy, and with it the copy of `ApiError` that copy recognises.
const startFresh = (): typeof ApiError => {
  let Refusal: typeof ApiError = ApiError
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports -- one registry of its own, with the mocks above */
    Refusal = (require('../graphql') as typeof import('@dripfunnel/mobile-shared/graphql')).ApiError
    ;(require('./report') as typeof import('./report')).startReporting()
    /* eslint-enable @typescript-eslint/no-require-imports */
  })
  return Refusal
}

describe('crash reports', () => {
  it('send nothing, and touch no Firebase, for a build without its store’s files', () => {
    mockSetup.on = false
    startReporting()
    reportError(new Error('boom'))
    setReportingUser('c-1')
    setReportingStore('s-1')
    expect(mockSent).toEqual({ enabled: [], errors: [], users: [], attributes: [] })
  })

  it('switch collection on once, and clean an uncaught error before Crashlytics’ own handler records it', () => {
    startReporting()
    startReporting()
    expect(mockSent.enabled).toEqual([true])
    handler(new ApiError('SIGNED_OUT', 'Ana Rao, ana@example.com, signed out'), true)
    expect(chained).toHaveLength(1)
    expect(chained[0]?.message).toBe('SIGNED_OUT')
  })

  it('replace the rejection handler Crashlytics enables itself, after it has, with one that records the scrubbed error', () => {
    const Refusal = startFresh()
    expect(mockOrder).toEqual(['crashlytics', 'tracking'])
    expect(mockTracking.options?.allRejections).toBe(true)
    mockTracking.options?.onUnhandled?.(0, new Refusal('CODE_REFUSED', 'Ana Rao ana@example.com +91 98765 43210 asked for a code'))
    mockTracking.options?.onUnhandled?.(1, new TypeError('Cannot read 1 High St, 10001, ₹1,299.00'))
    mockTracking.options?.onUnhandled?.(2, 'a thrown string with sam@example.com')
    expect(mockSent.errors.map((e) => e.message)).toEqual(['CODE_REFUSED', 'TypeError', 'string'])
    const written = mockSent.errors.map((e) => `${e.message}\n${e.stack}`).join('\n')
    for (const secret of ['Ana Rao', 'example.com', '98765', 'High St', '10001', '1,299']) expect(written).not.toContain(secret)
  })

  it('leave the rejection tracker alone in a build without the files', () => {
    mockSetup.on = false
    startFresh()
    expect(mockTracking.options).toBeNull()
  })

  it('record a caught error by its code or class only', () => {
    reportError(new ApiError('NO_RESPONSE', 'No connection for +91 98765 43210'))
    reportError(new RangeError('4000 is past ₹1,299.00'))
    expect(mockSent.errors.map((e) => e.message)).toEqual(['NO_RESPONSE', 'RangeError'])
  })

  it('know the acting store by its opaque id as the one custom key, and by none when no store is acting', () => {
    setReportingStore('store-7a1')
    setReportingStore(null)
    expect(mockSent.attributes).toEqual([
      ['storeId', 'store-7a1'],
      ['storeId', ''],
    ])
  })

  it('know the person by an opaque id when signed in, and by none when not', () => {
    setReportingUser('c-9f2')
    setReportingUser(null)
    expect(mockSent.users).toEqual(['c-9f2', ''])
  })
})
