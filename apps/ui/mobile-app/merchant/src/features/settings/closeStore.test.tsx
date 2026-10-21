import type { ReactElement } from 'react'
import { Share } from 'react-native'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, hasText, press, pressableNamed, pressablesNamed, renderShell } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { SettingsTabScreen } from './SettingsTabScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
    useNavigation: () => ({ dispatch: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }))
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(), requestCameraPermissionsAsync: async () => ({ granted: true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../products/files', () => ({ fileDeps: () => ({ domain: 'shop.test', headers: () => ({ authorization: 'Bearer token' }) }) }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>
type Options = Parameters<typeof renderShell>[1]

const show = async (element: ReactElement, handlers: Handlers, options: Options = {}) => {
  const { client, calls } = fakeApi(handlers)
  mockSession.client = client
  const renderer = await renderShell(element, options)
  await settle()
  return { renderer, calls }
}

const click = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressableNamed(renderer, label))
  await settle()
}
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

const info = {
  name: 'Kesari Threads',
  legalName: null,
  description: null,
  logoAssetId: null,
  address: { street: '14 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' },
  contactEmail: 'hello@kesarithreads.in',
  contactPhone: null,
  country: 'IN',
  taxId: null,
  timeZone: 'Asia/Kolkata',
  unitSystem: 'metric',
  orderPrefix: 'KT-',
  nextOrderNumber: '1042',
}
const locale = { pricingCurrency: 'INR', mainLanguage: 'en-IN', offeredLanguages: ['en-IN'], currencies: [], languages: [{ code: 'en-IN', status: 'active' }], examples: [] }

const paid = { status: 'active', price: { amount: '99900', currency: 'INR' }, periodEnd: '2026-10-27T00:00:00Z', cancelAt: null }
const trial = { status: 'trial', price: { amount: '0', currency: 'INR' }, periodEnd: '2026-10-27T00:00:00Z', cancelAt: null }
const closing = { status: 'cancelled', price: { amount: '99900', currency: 'INR' }, periodEnd: '2026-10-27T00:00:00Z', cancelAt: '2026-10-27T00:00:00Z' }

const store = (subscription: unknown, over: Handlers = {}): Handlers => ({
  '{ storeInfo {': () => ({ storeInfo: info }),
  '{ storeLocale {': () => ({ storeLocale: locale }),
  'query Progress': () => ({}),
  '{ subscription {': () => ({ subscription }),
  ...over,
})

const part = (kind: string, rows: number, state = 'done') => ({ id: `p-${kind}`, kind, state, rows, truncated: false, csv: `name\n${kind}\n`, expiresAt: null })
const parts = [part('products', 12), part('orders', 3), part('customers', 7)]

describe('Close my store', () => {
  it('is at the end of Store info for the Owner, and says what closing does before anything is sent', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store(paid))

    expect(hasText(renderer, 'Takes your shop offline.')).toBe(true)
    await click(renderer, 'Close my store…')

    expect(hasText(renderer, 'Close your store?')).toBe(true)
    expect(hasText(renderer, 'Your shop keeps selling until Oct 27, 2026, then goes offline. The portal becomes view-only now.')).toBe(true)
    expect(hasText(renderer, 'Products, orders and customers are kept for 90 days, then deleted.')).toBe(true)
    expect(asked(calls, 'mutation CancelStore')).toHaveLength(0)
  })

  it('says a trial or free plan goes offline at once', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="store" />, store(trial))
    await click(renderer, 'Close my store…')

    expect(hasText(renderer, 'Your shop goes offline now, and the portal becomes view-only.')).toBe(true)
  })

  it('is not there for a Manager, Staff or a supplier, and reads nothing for them', async () => {
    for (const acting of [actingAs('manager'), actingAs('staff'), actingAs('supplier-admin', 'vendor-orders-fulfil')]) {
      const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store(paid), { acting })

      expect(pressablesNamed(renderer, 'Close my store…')).toHaveLength(0)
      expect(hasText(renderer, 'Close my store')).toBe(false)
      expect(asked(calls, '{ subscription {')).toHaveLength(0)
      expect(asked(calls, 'mutation CancelStore')).toHaveLength(0)
    }
  })

  it('restates the consequence once more at the confirmation, then closes and says until when', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store(paid, { 'mutation CancelStore': () => ({ cancelStore: { ...paid, status: 'cancelled', cancelAt: '2026-10-27T00:00:00Z' } }) }))
    await click(renderer, 'Close my store…')
    await click(renderer, 'Continue')

    expect(hasText(renderer, 'Close Juniper & Co.?')).toBe(true)
    expect(hasText(renderer, 'Your shop keeps selling until Oct 27, 2026, then goes offline.')).toBe(true)
    expect(asked(calls, 'mutation CancelStore')).toHaveLength(0)

    await click(renderer, 'Close my store')

    expect(asked(calls, 'mutation CancelStore')).toHaveLength(1)
    expect(hasText(renderer, 'Your store is closing. It sells until Oct 27, 2026.')).toBe(true)
  })

  it('keeps the store when the Owner backs out', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store(paid))
    await click(renderer, 'Close my store…')
    await click(renderer, 'Keep my store')

    expect(hasText(renderer, 'Close your store?')).toBe(false)
    expect(asked(calls, 'mutation CancelStore')).toHaveLength(0)
  })

  it.each([
    ['BILLED_BY_PARTNER', 'Your provider bills you directly. Ask them to close your store.'],
    ['PROVIDER_UNAVAILABLE', 'We couldn’t reach our payment provider. Nothing was closed; try again in a minute.'],
    ['CANCELLED', 'Your store is already closing.'],
    ['FORBIDDEN', 'Only the store owner can close the store or download its data.'],
  ])('shows a refusal by its code, %s, and stays on the confirmation', async (code, words) => {
    const { renderer } = await show(
      <SettingsTabScreen tab="store" />,
      store(paid, {
        'mutation CancelStore': () => {
          throw new ApiError(code, 'refused')
        },
      }),
    )
    await click(renderer, 'Close my store…')
    await click(renderer, 'Continue')
    await click(renderer, 'Close my store')

    expect(hasText(renderer, words)).toBe(true)
    expect(hasText(renderer, 'Close Juniper & Co.?')).toBe(true)
  })

  it('offers the data first: the three parts, each shared as CSV through the share sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction })
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store(paid, { 'mutation ExportStoreData': () => ({ exportStoreData: 'bundle-1' }), 'query StoreDataExport': () => ({ storeDataExport: parts }) }))
    await click(renderer, 'Close my store…')
    await click(renderer, 'Download my data first')

    expect(asked(calls, 'mutation ExportStoreData')).toHaveLength(1)
    expect(asked(calls, 'query StoreDataExport')[0]?.variables).toEqual({ id: 'bundle-1' })
    expect(hasText(renderer, 'Your data')).toBe(true)
    expect(hasText(renderer, '12 rows')).toBe(true)
    expect(hasText(renderer, '3 rows')).toBe(true)
    expect(hasText(renderer, '7 rows')).toBe(true)

    await click(renderer, 'Share Orders')
    expect(share).toHaveBeenCalledWith({ title: 'Orders', message: 'name\norders\n' })

    await click(renderer, 'Back')
    expect(hasText(renderer, 'Close your store?')).toBe(true)
  })

  it('says a part is still being prepared, and one that could not be, with a way to ask again', async () => {
    jest.useFakeTimers()
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store(paid, { 'mutation ExportStoreData': () => ({ exportStoreData: 'bundle-1' }), 'query StoreDataExport': () => ({ storeDataExport: [part('products', 12), { ...part('orders', 0, 'failed'), csv: null }, { ...part('customers', 0, 'queued'), csv: null }] }) }))
    await click(renderer, 'Close my store…')
    await click(renderer, 'Download my data first')

    expect(hasText(renderer, 'Preparing…')).toBe(true)
    expect(hasText(renderer, 'Couldn’t be prepared. Try again.')).toBe(true)
    expect(asked(calls, 'mutation ExportStoreData')).toHaveLength(1)
    await act(async () => renderer.unmount())
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('says why the export was refused', async () => {
    const { renderer } = await show(
      <SettingsTabScreen tab="store" />,
      store(paid, {
        'mutation ExportStoreData': () => {
          throw new ApiError('FORBIDDEN', 'refused')
        },
      }),
    )
    await click(renderer, 'Close my store…')
    await click(renderer, 'Download my data first')

    expect(hasText(renderer, 'Only the store owner can close the store or download its data.')).toBe(true)
    expect(pressablesNamed(renderer, 'Download again')).toHaveLength(1)
  })

  it('shows a closing store as closing, with its data, and no way to close it again', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store(closing, { 'mutation ExportStoreData': () => ({ exportStoreData: 'bundle-1' }), 'query StoreDataExport': () => ({ storeDataExport: parts }) }))

    expect(hasText(renderer, 'Your store is closing')).toBe(true)
    expect(hasText(renderer, 'Your shop closes on Oct 27, 2026.')).toBe(true)
    expect(pressablesNamed(renderer, 'Close my store…')).toHaveLength(0)

    await click(renderer, 'Download my data')
    expect(asked(calls, 'mutation ExportStoreData')).toHaveLength(1)
    expect(hasText(renderer, '12 rows')).toBe(true)
  })

  it('leaves Store info working when the plan cannot be read, and reads it again on request', async () => {
    let tries = 0
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="store" />,
      store(paid, {
        '{ subscription {': () => {
          tries += 1
          if (tries === 1) throw new ApiError('NO_RESPONSE', 'down')
          return { subscription: paid }
        },
      }),
    )

    expect(hasText(renderer, 'Closing couldn’t be checked right now.')).toBe(true)
    expect(hasText(renderer, 'Your store')).toBe(true)
    await click(renderer, 'Try again')

    expect(asked(calls, '{ subscription {')).toHaveLength(2)
    expect(pressablesNamed(renderer, 'Close my store…')).toHaveLength(1)
  })
})
