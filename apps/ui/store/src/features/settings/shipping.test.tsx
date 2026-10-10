// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Acting } from '../../api/shell'
import type { Courier, ShippingSettings } from '../../api/shipping'
import { messages } from '../../messages'
import { maxPostalCodes, readPostalCodes } from './postalCodes'
import { settingsSearch } from './settingsSearch'

// Settings › Shipping driven as the Owner would (SetOps "shipping"): one draft saved over its revision, couriers and
// the postcode list changed on their own without losing what is typed.

const w = messages.settings.shipping

const ship = vi.hoisted(() => ({
  loadShipping: vi.fn(),
  saveShipping: vi.fn(),
  replaceDeliveryArea: vi.fn(),
  connectCourier: vi.fn(),
  useCourierForPricing: vi.fn(),
  disconnectCourier: vi.fn(),
  saveCourierOptions: vi.fn(),
  testCouriers: vi.fn(),
}))
vi.mock('../../api/shipping', async (actual) => ({ ...(await actual<typeof import('../../api/shipping')>()), ...ship }))
const settings = vi.hoisted(() => ({ loadStoreInfo: vi.fn(), loadLocale: vi.fn() }))
vi.mock('../../api/settings', () => settings)

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['settings', 'shipping.configure'] }
const supplier: Acting = { ...owner, role: 'staff', seller: { id: 'v1', name: 'Northwind' }, tier: 'vendor-catalogue', permissions: ['catalog.read'] } as Acting

const courier = (c: Partial<Courier> & Pick<Courier, 'provider' | 'status'>): Courier => ({ offered: true, pickupMode: 'scheduled', labelSize: '4x6', trackingEmails: true, lastTestedAt: null, lastTestResult: null, ...c })

const us: ShippingSettings = {
  revision: 4,
  savedAt: '2026-10-01T09:00:00Z',
  currency: 'USD',
  courierRate: true,
  flatRate: false,
  flatAmount: '900',
  pickup: false,
  pickupHours: null,
  pickupAddress: '12 Elm St, Columbus',
  freeMode: 'never',
  freeThresholdAmount: null,
  areaMode: 'everywhere',
  areaFileName: null,
  areaCount: 0,
  areaSample: [],
  labelSizes: ['4x6', 'letter'],
  couriers: [courier({ provider: 'usps', status: 'pricing' }), courier({ provider: 'ups', status: 'standby' }), courier({ provider: 'fedex', status: 'off', offered: false })],
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog[open]') as HTMLElement)
const region = (name: string) => within(screen.getByRole('region', { name }))
const saveButton = () => screen.getByRole('button', { name: w.saveShipping }) as HTMLButtonElement
const box = (name: RegExp | string) => screen.getByRole('checkbox', { name }) as HTMLInputElement
const radio = (name: RegExp | string) => screen.getByRole('radio', { name }) as HTMLInputElement

const show = async ({ acting = owner, readOnly = false } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: settingsSearch, component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: ['/settings?tab=shipping'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

beforeEach(() => {
  ship.loadShipping.mockResolvedValue(us)
  settings.loadStoreInfo.mockResolvedValue({ country: 'US' })
  ship.saveShipping.mockResolvedValue(5)
  for (const fn of [ship.useCourierForPricing, ship.saveCourierOptions]) fn.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('what the shopper pays', () => {
  it('shows each way on at once, the courier that quotes, and the flat rate kept as the fallback', async () => {
    await show()
    expect(box(/The courier’s live rate/).checked).toBe(true)
    expect(screen.getByText('Quoted at checkout by USPS, from address and weight.')).toBeTruthy()
    expect(box(/A flat rate/).checked).toBe(false)
    expect(screen.getByText(w.flatFallback)).toBeTruthy()
    expect((screen.getByLabelText(w.flatLabel) as HTMLInputElement).value).toBe('9.00')
    expect(saveButton().disabled).toBe(true)
  })

  it('saves several ways at once, amounts in minor units, over the revision it read', async () => {
    await show()
    fireEvent.click(box(/A flat rate/))
    fireEvent.change(screen.getByLabelText(w.flatLabel), { target: { value: '12.5' } })
    fireEvent.click(box(/collect in person/))
    fireEvent.click(screen.getByRole('button', { name: w.setHours }))
    fireEvent.change(dialog().getByLabelText(w.hoursLabel), { target: { value: ' Mon–Fri, 9–5 ' } })
    fireEvent.click(dialog().getByRole('button', { name: w.saveHours }))
    fireEvent.click(radio(/On orders over an amount/))
    fireEvent.change(screen.getByLabelText(w.thresholdLabel), { target: { value: '75' } })
    expect(screen.getByText('Orders of $75.00 or more ship free.')).toBeTruthy()
    fireEvent.click(saveButton())
    await settle()
    expect(ship.saveShipping).toHaveBeenCalledWith(4, { courierRate: true, flatRate: true, flatAmount: '1250', pickup: true, pickupHours: 'Mon–Fri, 9–5', freeMode: 'over', freeThresholdAmount: '7500', areaMode: 'everywhere' })
    expect(screen.getByText(w.saved)).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
  })

  it.each([
    ['no way at all', () => fireEvent.click(box(/The courier’s live rate/)), w.missing.method],
    ['a flat rate with no amount', () => (fireEvent.click(box(/A flat rate/)), fireEvent.change(screen.getByLabelText(w.flatLabel), { target: { value: '' } })), w.missing.flat],
    ['an amount that isn’t one', () => fireEvent.change(screen.getByLabelText(w.flatLabel), { target: { value: '9,99' } }), 'Type an amount like 49.00.'],
    ['collection with no hours', () => fireEvent.click(box(/collect in person/)), w.missing.hours],
    ['an uploaded list with none uploaded', () => fireEvent.click(radio(/Only ZIP codes I upload/)), 'Upload your ZIP code list, or choose “Everywhere”.'],
  ])('refuses %s before sending anything, on the form', async (_, change, said) => {
    await show()
    change()
    fireEvent.click(saveButton())
    await settle()
    expect(ship.saveShipping).not.toHaveBeenCalled()
    expect(region(w.areaTitle).getByRole('alert').textContent).toBe(said)
  })

  it('says someone else saved since, and keeps what was typed', async () => {
    ship.saveShipping.mockRejectedValueOnce(new ApiError('STALE', 'stale'))
    await show()
    fireEvent.click(box(/A flat rate/))
    fireEvent.click(saveButton())
    await settle()
    expect(region(w.areaTitle).getByRole('alert').textContent).toBe(w.refused.STALE)
    expect(box(/A flat rate/).checked).toBe(true)
    expect(region(w.partnersTitle).queryByRole('alert')).toBeNull()
  })

  it('lets a read-only store look without changing anything', async () => {
    await show({ readOnly: true })
    expect(box(/The courier’s live rate/).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: w.saveShipping })).toBeNull()
    expect(screen.queryByRole('button', { name: w.testAll })).toBeNull()
    expect(screen.queryByRole('button', { name: /Manage|Disconnect|Use .* for pricing/ })).toBeNull()
  })

  it('reads nothing for anyone but the Owner', async () => {
    await show({ acting: supplier })
    expect(screen.getByText(messages.settings.denied.title)).toBeTruthy()
    expect(ship.loadShipping).not.toHaveBeenCalled()
  })
})

describe('delivery partners', () => {
  it('lists each courier’s part, and offers only what its state allows', async () => {
    await show()
    const p = region(w.partnersTitle)
    expect(p.getByText(w.status.pricing)).toBeTruthy()
    expect(p.getByText('Quotes every order at checkout · pickups every working day · labels 4 × 6 in')).toBeTruthy()
    expect(p.getByRole('button', { name: 'Use UPS for pricing' })).toBeTruthy()
    expect(p.queryByRole('button', { name: 'Use USPS for pricing' })).toBeNull()
    expect(p.getByText(w.descNotOffered)).toBeTruthy()
    expect(p.queryByRole('button', { name: 'Connect FedEx' })).toBeNull()
  })

  it('a disconnect read back keeps what was typed, and takes what the server changed', async () => {
    // The last courier going switches the courier's rate off on the server, with a new revision.
    ship.loadShipping.mockResolvedValueOnce(us).mockResolvedValue({ ...us, revision: 6, courierRate: false, couriers: [courier({ provider: 'usps', status: 'off' }), courier({ provider: 'ups', status: 'pricing' }), us.couriers[2]] })
    ship.disconnectCourier.mockResolvedValue('ups')
    await show()
    fireEvent.click(box(/collect in person/))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect USPS' }))
    expect(dialog().getByText('UPS takes over pricing orders.')).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: w.disconnect }))
    await settle()
    expect(screen.getByText('USPS disconnected — UPS prices orders now')).toBeTruthy()
    expect(box(/collect in person/).checked).toBe(true)
    expect(box(/The courier’s live rate/).checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: w.setHours }))
    fireEvent.change(dialog().getByLabelText(w.hoursLabel), { target: { value: 'Sat 10–2' } })
    fireEvent.click(dialog().getByRole('button', { name: w.saveHours }))
    fireEvent.click(saveButton())
    await settle()
    expect(ship.saveShipping).toHaveBeenCalledWith(6, expect.objectContaining({ courierRate: false, pickup: true, pickupHours: 'Sat 10–2' }))
  })

  it('connects a courier on the partner’s account and says its part', async () => {
    ship.loadShipping.mockResolvedValue({ ...us, couriers: [courier({ provider: 'usps', status: 'off' })] })
    ship.connectCourier.mockResolvedValue('pricing')
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Connect USPS' }))
    await settle()
    expect(ship.connectCourier).toHaveBeenCalledWith('usps')
    expect(screen.getByText('USPS connected — it prices orders at checkout')).toBeTruthy()
  })

  it('says why a courier change was refused, on the partners card only', async () => {
    ship.useCourierForPricing.mockRejectedValueOnce(new ApiError('NOT_CONNECTED', 'no'))
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Use UPS for pricing' }))
    await settle()
    expect(region(w.partnersTitle).getByRole('alert').textContent).toBe(w.refused.NOT_CONNECTED)
    expect(region(w.areaTitle).queryByRole('alert')).toBeNull()
  })

  it('saves pickups, label size and tracking emails from Manage', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Manage USPS' }))
    fireEvent.change(dialog().getByLabelText(w.pickupsLabel), { target: { value: 'on_request' } })
    fireEvent.change(dialog().getByLabelText(w.labelLabel), { target: { value: 'letter' } })
    fireEvent.change(dialog().getByLabelText(w.trackingLabel), { target: { value: 'off' } })
    fireEvent.click(dialog().getByRole('button', { name: w.save }))
    await settle()
    expect(ship.saveCourierOptions).toHaveBeenCalledWith('usps', { pickupMode: 'on_request', labelSize: 'letter', trackingEmails: false })
  })

  it('tests every connected courier and says how each answered', async () => {
    ship.testCouriers.mockResolvedValue([
      { provider: 'usps', result: 'ok', ms: 420 },
      { provider: 'ups', result: 'rejected', ms: 900 },
    ])
    await show()
    fireEvent.click(screen.getByRole('button', { name: w.testAll }))
    await settle()
    const results = region(w.partnersTitle).getByRole('status')
    expect(within(results).getByText('1 of 2 didn’t answer')).toBeTruthy()
    expect(within(results).getByText('USPS — quoted a test parcel to your own address in 0.4 s')).toBeTruthy()
    expect(within(results).getByText(w.testResults.rejected.replace('{name}', 'UPS'))).toBeTruthy()
  })
})

describe('where you deliver', () => {
  const upload = async (name: string, text: string) => {
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await act(async () => fireEvent.change(input, { target: { files: [new File([text], name, { type: 'text/csv' })] } }))
    await settle()
  }

  it('reads the codes from the file, sends only codes of the store’s shape, and keeps the draft', async () => {
    ship.loadShipping.mockResolvedValueOnce(us).mockResolvedValue({ ...us, areaFileName: 'zips.csv', areaCount: 2, areaSample: ['43004', '43215'] })
    ship.replaceDeliveryArea.mockResolvedValue(2)
    await show()
    fireEvent.click(radio(/Only ZIP codes I upload/))
    expect(screen.getByText(w.listNone)).toBeTruthy()
    fireEvent.click(box(/A flat rate/))
    await upload('zips.csv', 'zip,city\n43004,Columbus\n43215-1234,Columbus\n43004,again\n')
    expect(ship.replaceDeliveryArea).toHaveBeenCalledWith('zips.csv', ['43004', '43215-1234'])
    expect(screen.getByText('2 ZIP codes read from zips.csv. Save shipping to deliver only there.')).toBeTruthy()
    expect(screen.getByText('zips.csv · 2 codes, e.g. 43004, 43215')).toBeTruthy()
    expect(radio(/Only ZIP codes I upload/).checked).toBe(true)
    expect(box(/A flat rate/).checked).toBe(true)
  })

  it('refuses a file that isn’t text, or holds no codes, sending nothing', async () => {
    await show()
    fireEvent.click(radio(/Only ZIP codes I upload/))
    await upload('zips.xlsx', '43004')
    expect(region(w.areaTitle).getByRole('alert').textContent).toBe('zips.xlsx isn’t a CSV or text file — save it as CSV and try again.')
    await upload('zips.csv', 'zip\nnone here\n')
    expect(region(w.areaTitle).getByRole('alert').textContent).toBe('We couldn’t find any ZIP codes in zips.csv.')
    expect(ship.replaceDeliveryArea).not.toHaveBeenCalled()
  })
})

describe('reading a postcode list', () => {
  it('keeps the store’s own shape, once each', () => {
    expect(readPostalCodes('pins.txt', '302003, 302003; 110001 "560001" 012345 hello', 'IN')).toEqual({ kind: 'codes', codes: ['302003', '110001', '560001'] })
  })

  it('stops at the most a list may hold', () => {
    const text = Array.from({ length: maxPostalCodes + 1 }, (_, i) => String(10000 + i).padStart(5, '0')).join('\n')
    expect(readPostalCodes('zips.csv', text, 'US')).toEqual({ kind: 'tooMany' })
  })
})
