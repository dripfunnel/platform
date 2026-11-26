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

const riders = vi.hoisted(() => ({ loadRiderPlan: vi.fn(), loadRiders: vi.fn() }))
vi.mock('../../api/riders', async (actual) => ({ ...(await actual<typeof import('../../api/riders')>()), ...riders }))

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['settings', 'shipping.configure'] }
const supplier: Acting = { ...owner, role: 'staff', seller: { id: 'v1', name: 'Northwind' }, tier: 'vendor-catalogue', permissions: ['catalog.read'] } as Acting

const courier = (c: Partial<Courier> & Pick<Courier, 'provider' | 'status'>): Courier => ({ offered: true, accountEmail: null, accountChannelId: null, pickupMode: 'scheduled', labelSize: '4x6', trackingEmails: true, lastTestedAt: null, lastTestResult: null, ...c })

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
  ownDelivery: false,
  dispatchWhen: 'ready',
  offerMinutes: 5,
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
  riders.loadRiderPlan.mockResolvedValue({ ownDelivery: false })
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

  it('connects a courier that needs no login and says its part', async () => {
    ship.loadShipping.mockResolvedValue({ ...us, couriers: [courier({ provider: 'usps', status: 'off' })] })
    ship.connectCourier.mockResolvedValue('pricing')
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Connect USPS' }))
    await settle()
    expect(ship.connectCourier).toHaveBeenCalledWith('usps')
    expect(screen.getByText('USPS connected — it prices orders at checkout')).toBeTruthy()
  })

  describe('Shiprocket, on the store’s own API user (#1489)', () => {
    const offShiprocket = () => ship.loadShipping.mockResolvedValue({ ...us, couriers: [courier({ provider: 'shiprocket', status: 'off' })] })
    const typeLogin = () => {
      fireEvent.change(dialog().getByLabelText(w.login.email), { target: { value: ' api@kesari.example ' } })
      fireEvent.change(dialog().getByLabelText(w.login.password), { target: { value: 'S3cret pass' } })
    }

    it('opens a form for the API user’s email and password, with the way to create one, and sends the login once', async () => {
      offShiprocket()
      ship.connectCourier.mockResolvedValue('pricing')
      await show()
      fireEvent.click(screen.getByRole('button', { name: 'Connect Shiprocket' }))
      const form = dialog()
      expect(form.getByRole('heading', { name: 'Connect Shiprocket' })).toBeTruthy()
      expect(form.getByRole('link', { name: w.login.link }).getAttribute('href')).toBe(w.login.url)
      expect((form.getByLabelText(w.login.password) as HTMLInputElement).type).toBe('password')
      expect((form.getByRole('button', { name: w.login.confirm }) as HTMLButtonElement).disabled).toBe(true)
      expect(form.getByText(w.login.missing)).toBeTruthy()
      typeLogin()
      fireEvent.click(form.getByRole('button', { name: w.login.confirm }))
      await settle()
      expect(ship.connectCourier).toHaveBeenCalledWith('shiprocket', { email: 'api@kesari.example', password: 'S3cret pass', webhookToken: null, channelId: null })
      expect(screen.getByText('Shiprocket connected — it prices orders at checkout')).toBeTruthy()
      expect(document.querySelector('dialog[open]')).toBeNull()
    })

    it('says it is connecting while Shiprocket is asked, then shows the answer', async () => {
      offShiprocket()
      let answer: (status: 'pricing') => void = () => undefined
      ship.connectCourier.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      await show()
      fireEvent.click(screen.getByRole('button', { name: 'Connect Shiprocket' }))
      typeLogin()
      fireEvent.click(dialog().getByRole('button', { name: w.login.confirm }))
      await settle()
      expect((dialog().getByRole('button', { name: w.login.connecting }) as HTMLButtonElement).disabled).toBe(true)
      answer('pricing')
      await settle()
      expect(screen.getByText('Shiprocket connected — it prices orders at checkout')).toBeTruthy()
    })

    it('sends the tracking token and the sales channel when they are typed', async () => {
      offShiprocket()
      ship.connectCourier.mockResolvedValue('standby')
      await show()
      fireEvent.click(screen.getByRole('button', { name: 'Connect Shiprocket' }))
      typeLogin()
      fireEvent.change(dialog().getByLabelText(w.login.token), { target: { value: ' hook-token-12345678 ' } })
      fireEvent.change(dialog().getByLabelText(w.login.channel), { target: { value: ' 4321 ' } })
      fireEvent.click(dialog().getByRole('button', { name: w.login.confirm }))
      await settle()
      expect(ship.connectCourier).toHaveBeenCalledWith('shiprocket', { email: 'api@kesari.example', password: 'S3cret pass', webhookToken: 'hook-token-12345678', channelId: '4321' })
    })

    it('will not send a tracking token shorter than 16 characters, and says why', async () => {
      offShiprocket()
      await show()
      fireEvent.click(screen.getByRole('button', { name: 'Connect Shiprocket' }))
      typeLogin()
      fireEvent.change(dialog().getByLabelText(w.login.token), { target: { value: 'short' } })
      expect((dialog().getByRole('button', { name: w.login.confirm }) as HTMLButtonElement).disabled).toBe(true)
      expect(dialog().getByText(w.login.tokenShort)).toBeTruthy()
      fireEvent.change(dialog().getByLabelText(w.login.token), { target: { value: 'sixteen-chars-ok!' } })
      expect((dialog().getByRole('button', { name: w.login.confirm }) as HTMLButtonElement).disabled).toBe(false)
    })

    it.each([
      ['LOGIN_REFUSED', w.refused.LOGIN_REFUSED],
      ['COURIER_UNAVAILABLE', w.refused.COURIER_UNAVAILABLE],
    ])('keeps the form open with what was typed when the answer is %s, and shows nothing connected', async (code, said) => {
      offShiprocket()
      ship.connectCourier.mockRejectedValueOnce(new ApiError(code, 'no'))
      await show()
      fireEvent.click(screen.getByRole('button', { name: 'Connect Shiprocket' }))
      typeLogin()
      fireEvent.click(dialog().getByRole('button', { name: w.login.confirm }))
      await settle()
      expect(dialog().getByRole('alert').textContent).toBe(said)
      expect((dialog().getByLabelText(w.login.email) as HTMLInputElement).value).toBe('api@kesari.example')
      expect((dialog().getByLabelText(w.login.password) as HTMLInputElement).value).toBe('S3cret pass')
      expect(screen.queryByText(/Shiprocket connected/)).toBeNull()
    })

    it('shows who it is connected as, never the password, and Fix for a login Shiprocket refused', async () => {
      ship.loadShipping.mockResolvedValue({ ...us, couriers: [courier({ provider: 'shiprocket', status: 'failed', accountEmail: 'api@kesari.example', lastTestResult: 'rejected' })] })
      await show()
      expect(screen.getByText('Connected as api@kesari.example')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Fix Shiprocket' }))
      expect((dialog().getByLabelText(w.login.password) as HTMLInputElement).value).toBe('')
    })

    it('offers neither Connect nor Fix to a store that may only read', async () => {
      ship.loadShipping.mockResolvedValue({ ...us, couriers: [courier({ provider: 'shiprocket', status: 'off' })] })
      await show({ readOnly: true })
      expect(screen.queryByRole('button', { name: /Connect Shiprocket|Fix Shiprocket/ })).toBeNull()
    })
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

describe('Shipping › The courier’s live rate needs a connected partner (#1755)', () => {
  const live = () => box(new RegExp(w.courierRate))
  const message = 'Please connect Shiprocket first.'
  const noPartner = (courierRate: boolean) => ship.loadShipping.mockResolvedValue({ ...us, courierRate, couriers: [courier({ provider: 'shiprocket', status: 'off' })] })

  it('is disabled with the reason while no delivery partner is connected, and a click ticks nothing', async () => {
    noPartner(false)
    await show()
    expect(live().disabled).toBe(true)
    expect(screen.getByTitle(message)).toBeTruthy()
    const reason = document.getElementById(live().getAttribute('aria-describedby') ?? '')
    expect(reason?.textContent).toBe(message)
    fireEvent.click(live())
    expect(live().checked).toBe(false)
  })

  it('asks a store that is not offered Shiprocket to connect a delivery partner', async () => {
    ship.loadShipping.mockResolvedValue({ ...us, courierRate: false, couriers: [courier({ provider: 'usps', status: 'off' }), courier({ provider: 'ups', status: 'off' })] })
    await show()
    expect(live().disabled).toBe(true)
    expect(screen.getByTitle('Please connect a delivery partner first.')).toBeTruthy()
    expect(screen.queryByTitle(message)).toBeNull()
  })

  it('does not send a store to Shiprocket when Shiprocket is listed but not offered to it', async () => {
    ship.loadShipping.mockResolvedValue({ ...us, courierRate: false, couriers: [courier({ provider: 'shiprocket', status: 'off', offered: false })] })
    await show()
    expect(screen.queryByRole('button', { name: 'Connect Shiprocket' })).toBeNull()
    expect(screen.getByTitle('Please connect a delivery partner first.')).toBeTruthy()
    expect(screen.queryByTitle(message)).toBeNull()
  })

  it('ticks as before once a partner is connected', async () => {
    ship.loadShipping.mockResolvedValue({ ...us, courierRate: false })
    await show()
    expect(live().disabled).toBe(false)
    expect(screen.queryByTitle(message)).toBeNull()
    fireEvent.click(live())
    expect(live().checked).toBe(true)
  })

  it('shows unticked and disabled when it is saved on but no partner is connected', async () => {
    noPartner(true)
    await show()
    expect(live().checked).toBe(false)
    expect(live().disabled).toBe(true)
  })

  it('unticks after the last partner is disconnected, even when it was ticked a moment before', async () => {
    ship.loadShipping.mockResolvedValueOnce({ ...us, courierRate: false }).mockResolvedValue({ ...us, courierRate: true, couriers: [courier({ provider: 'usps', status: 'off' })] })
    ship.disconnectCourier.mockResolvedValue(null)
    await show()
    fireEvent.click(live())
    expect(live().checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect USPS' }))
    fireEvent.click(dialog().getByRole('button', { name: w.disconnect }))
    await settle()
    expect(live().checked).toBe(false)
    expect(live().disabled).toBe(true)
  })

  it('gives no hover message to a store that can only look', async () => {
    noPartner(false)
    await show({ readOnly: true })
    expect(screen.queryByTitle(message)).toBeNull()
  })
})
