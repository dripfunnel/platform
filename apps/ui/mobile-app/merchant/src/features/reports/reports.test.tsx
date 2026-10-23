import type { ReactElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { ReportsScreen } from './ReportsScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockShare = jest.fn<Promise<boolean>, [string, string]>(async () => true)
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))
jest.mock('../common/shareCsv', () => ({ shareCsv: (title: string, csv: string) => mockShare(title, csv) }))

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>

const ownerPermissions = ['reports.read', 'billing', 'settings']
const managerPermissions = ['reports.read']
const access = (permissions: string[]) => ({ me: { acting: { permissions, seller: null } } })

const inr = (amount: string) => ({ amount, currency: 'INR' })
const reportOf = (over: Record<string, unknown> = {}) => ({
  days: 30,
  currency: 'INR',
  currencies: ['INR'],
  takings: { orders: 42, sales: inr('18452000'), refunds: inr('612000'), net: inr('17840000'), previousNet: inr('15210000'), previousOrders: 37 },
  sold: [{ productId: 'p1', name: 'Banarasi silk saree', units: 14, amount: inr('6986000') }],
  markets: [{ marketId: 'm1', name: 'India', orders: 38, amount: inr('15912000') }],
  tax: { by: 'rate', total: inr('2214000'), rows: [{ key: '500', orders: 30, amount: inr('612000') }, { key: null, orders: 9, amount: inr('114000') }] },
  offers: [{ name: 'DIWALI20', orders: 11, discount: inr('892000'), amount: inr('3568000') }],
  ...over,
})
const empty = reportOf({ currency: null, currencies: [], takings: null, sold: [], markets: [], tax: null, offers: [] })
const planLimit = (plan: string) => new ApiError('PLAN_LIMIT', 'Not in your plan.', { unlockedBy: { name: plan } })
const csv = 'Order,Net\nKT-1,4897.00\n'

const reports = (over: Handlers = {}, permissions: string[] = ownerPermissions): Handlers => ({
  'acting { permissions': () => access(permissions),
  'query Report(': (variables) => ({ report: reportOf({ days: variables.days, ...(variables.currency ? { currency: variables.currency } : {}) }), storeInfo: { country: 'IN' } }),
  'query Suppliers(': () => ({ report: { suppliers: [] } }),
  'mutation ExportReport(': () => ({ exportReport: 'job-1' }),
  'query ReportExport(': () => ({ reportExport: { id: 'job-1', state: 'done', rows: 2, truncated: false, csv, expiresAt: null } }),
  ...over,
})

const show = async (element: ReactElement, handlers: Handlers, role = 'owner') => {
  const { client, calls } = fakeApi(handlers)
  mockSession.client = client
  const renderer = await renderShell(element, { acting: actingAs(role) })
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

describe('Reports', () => {
  it('shows the last 30 days against the 30 before as stacked panels, every figure the API’s', async () => {
    const { renderer, calls } = await show(<ReportsScreen />, reports())

    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        'Reports',
        'Last 30 days, compared with the 30 days before · 42 orders',
        'How much you took',
        '₹178,400.00',
        '▲ 17% vs the previous 30 days',
        '−₹6,120.00',
        'What sold',
        'Banarasi silk saree · 14 sold',
        'Where it came from',
        'India',
        'GST you owe',
        '₹22,140.00',
        '5%',
        'On delivery',
        'Top offers',
        'Custom reports',
        'Build your own from any field',
        'Open',
      ]),
    )
    expect(hasText(renderer, 'Not much to show yet.')).toBe(false)
    expect(asked(calls, 'query Report(')[0]?.variables).toMatchObject({ days: 30, currency: null })
  })

  it('reads again for another range, and for another currency when the store sold in more than one', async () => {
    const { renderer, calls } = await show(<ReportsScreen />, reports({ 'query Report(': (variables) => ({ report: reportOf({ days: variables.days, currencies: ['INR', 'USD'] }), storeInfo: { country: 'IN' } }) }))

    await click(renderer, '7 days')
    expect(asked(calls, 'query Report(').at(-1)?.variables).toMatchObject({ days: 7 })
    expect(hasText(renderer, 'Last 7 days, compared with the 7 days before')).toBe(true)

    await click(renderer, 'USD')
    expect(asked(calls, 'query Report(').at(-1)?.variables).toMatchObject({ days: 7, currency: 'USD' })
  })

  it('draws a skeleton, never "not found", while the seat’s permissions are still loading', async () => {
    let release: () => void = () => undefined
    const pending = new Promise<unknown>((resolve) => (release = () => resolve(access(ownerPermissions))))
    const { renderer, calls } = await show(<ReportsScreen />, reports({ 'acting { permissions': () => pending }))

    expect(renderer.root.findAll((node) => node.props.accessibilityRole === 'progressbar').length).toBeGreaterThan(0)
    expect(hasText(renderer, 'This page isn’t here any more')).toBe(false)
    expect(hasText(renderer, 'How much you took')).toBe(false)
    expect(asked(calls, 'query Report(')).toHaveLength(0)

    release()
    await act(async () => void (await Promise.resolve()))
    expect(hasText(renderer, 'This page isn’t here any more')).toBe(false)
    await settle()
    expect(hasText(renderer, 'How much you took')).toBe(true)
    expect(hasText(renderer, 'This page isn’t here any more')).toBe(false)
  })

  it('still says "not found" when the API itself answers no report', async () => {
    const { renderer } = await show(<ReportsScreen />, reports({ 'query Report(': () => ({ report: null, storeInfo: { country: 'IN' } }) }))

    expect(hasText(renderer, 'This page isn’t here any more')).toBe(true)
  })

  it('tells Staff, who hold no `reports.read`, they have no access, and reads nothing', async () => {
    const { renderer, calls } = await show(<ReportsScreen />, reports({}, ['orders.read']), 'staff')

    expect(hasText(renderer, 'How much you took')).toBe(false)
    expect(asked(calls, 'query Report(')).toHaveLength(0)
  })

  it('names the plan that unlocks it below Growth, with no upgrade action, and a Manager is told to ask', async () => {
    const handlers = reports({ 'query Report(': () => Promise.reject(planLimit('Growth')) })
    const owner = await show(<ReportsScreen />, handlers)
    expect(texts(owner.renderer)).toEqual(expect.arrayContaining(['Takings, what sold, markets and tax — on Growth and up', 'Unlock reports', 'Growth']))
    expect(hasText(owner.renderer, 'Ask your store owner')).toBe(false)
    expect(pressablesNamed(owner.renderer, 'See plans')).toHaveLength(0)

    const manager = await show(<ReportsScreen />, reports({ 'query Report(': () => Promise.reject(planLimit('Growth')) }, managerPermissions), 'manager')
    expect(hasText(manager.renderer, 'Ask your store owner about the plan.')).toBe(true)
  })

  it('says a thin report is thin, and a range with no sales has nothing to export', async () => {
    const { renderer, calls } = await show(<ReportsScreen />, reports({ 'query Report(': () => ({ report: empty, storeInfo: { country: 'IN' } }) }))

    expect(hasText(renderer, 'Not much to show yet. Your first orders will show up here.')).toBe(true)
    expect(hasText(renderer, 'No sales in the last 30 days — try a longer range.')).toBe(true)

    await click(renderer, 'Export all')
    expect(hasText(renderer, 'Nothing to export — no orders in the last 30 days.')).toBe(true)
    expect(asked(calls, 'mutation ExportReport(')).toHaveLength(0)
  })

  it('shows the supplier panel only when some units are a supplier’s, and locks it on its own plan', async () => {
    const shared = await show(<ReportsScreen />, reports({ 'query Suppliers(': () => ({ report: { suppliers: [{ supplierId: null, name: null, units: 61 }, { supplierId: 's1', name: 'Northwind Textiles', units: 23 }] } }) }))
    expect(texts(shared.renderer)).toEqual(expect.arrayContaining(['Suppliers', 'Your own products', '61 units', 'Northwind Textiles', '23 units']))

    const own = await show(<ReportsScreen />, reports({ 'query Suppliers(': () => ({ report: { suppliers: [{ supplierId: null, name: null, units: 61 }] } }) }))
    expect(hasText(own.renderer, 'Suppliers')).toBe(false)

    const locked = await show(<ReportsScreen />, reports({ 'query Suppliers(': () => Promise.reject(planLimit('Growth Pro')) }))
    expect(hasText(locked.renderer, 'Export and the supplier report are on Growth Pro.')).toBe(true)
    expect(hasText(locked.renderer, 'How much you took')).toBe(true)
  })
})

describe('Reports export', () => {
  it('asks for the takings file over the range and currency on screen, and opens it in the share sheet when it is ready', async () => {
    const { renderer, calls } = await show(<ReportsScreen />, reports())

    await click(renderer, 'Export all')

    expect(asked(calls, 'mutation ExportReport(')[0]?.variables).toEqual({ panel: 'takings', days: 30, currency: 'INR', custom: null })
    expect(mockShare).toHaveBeenCalledWith('Reports export', csv)
    expect(hasText(renderer, '2 rows are ready.')).toBe(true)
  })

  it('exports one panel with its own button', async () => {
    const { renderer, calls } = await show(<ReportsScreen />, reports())

    await click(renderer, 'Export What sold')

    expect(asked(calls, 'mutation ExportReport(')[0]?.variables).toMatchObject({ panel: 'sold' })
  })

  it('says a refused export where it was asked, by its plan', async () => {
    const { renderer } = await show(<ReportsScreen />, reports({ 'mutation ExportReport(': () => Promise.reject(planLimit('Growth Pro')) }))

    await click(renderer, 'Export all')

    expect(hasText(renderer, 'That’s on Growth Pro.')).toBe(true)
    expect(mockShare).not.toHaveBeenCalled()
  })
})

describe('the custom report builder', () => {
  const openBuilder = async (renderer: ReactTestRenderer, rows: string, columns: string) => {
    await click(renderer, 'Export Custom reports')
    await click(renderer, rows)
    await click(renderer, 'Next')
    await click(renderer, columns)
  }

  it('asks the rows, then the columns, and makes the file as a job', async () => {
    const { renderer, calls } = await show(<ReportsScreen />, reports())

    await openBuilder(renderer, 'A product', '… plus stock left and supplier')
    expect(hasText(renderer, 'Uses the last 30 days, in INR.')).toBe(true)
    await click(renderer, 'Make report')

    expect(asked(calls, 'mutation ExportReport(')[0]?.variables).toEqual({ panel: 'custom', days: 30, currency: 'INR', custom: { rows: 'products', columns: 'stock' } })
    expect(mockShare).toHaveBeenCalledWith('Reports export', csv)
  })

  it('keeps a plan refusal in the sheet and names the plan on the card', async () => {
    const { renderer } = await show(<ReportsScreen />, reports({ 'mutation ExportReport(': () => Promise.reject(planLimit('Business')) }))

    await openBuilder(renderer, 'A customer', '… plus groups and tags')
    await click(renderer, 'Make report')

    expect(hasText(renderer, 'That’s on a bigger plan than this store has.')).toBe(true)
    expect(hasText(renderer, 'On Business.')).toBe(true)
    expect(mockShare).not.toHaveBeenCalled()
  })
})
