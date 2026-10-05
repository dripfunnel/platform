// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { optionalParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { StoreInfo, StoreLocale } from '../../api/settings'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'

// Settings › Store info driven as the Owner would (SetStore): the store's details, currencies and languages.

const words = messages.settings
const w = words.store

const api = vi.hoisted(() => ({ loadStoreInfo: vi.fn(), saveStoreInfo: vi.fn(), loadLocale: vi.fn(), saveCurrencies: vi.fn(), saveLanguages: vi.fn(), loadTranslationProgress: vi.fn() }))
vi.mock('../../api/settings', () => api)
const editorApi = vi.hoisted(() => ({ uploadPhoto: vi.fn() }))
vi.mock('../../api/productEditor', () => editorApi)

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'settings'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['catalog.read', 'catalog.write'] }

const info: StoreInfo = {
  name: 'Kesari Threads',
  legalName: 'Kesari Threads Pvt Ltd',
  description: 'Handloom from Jaipur',
  logoAssetId: null,
  address: { street: '14 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' },
  contactEmail: 'hello@kesari.in',
  contactPhone: '',
  country: 'IN',
  taxId: '',
  timeZone: 'Asia/Kolkata',
  unitSystem: 'metric',
  orderPrefix: 'KT-',
  nextOrderNumber: '1042',
}
const loc: StoreLocale = {
  pricingCurrency: 'INR',
  mainLanguage: 'en-IN',
  offeredLanguages: ['en-IN', 'en-US', 'hi-IN'],
  currencies: [
    { code: 'USD', mode: 'convert', rounding: 'ends-99', status: 'active' },
    { code: 'AED', mode: 'manual', rounding: 'none', status: 'active' },
    { code: 'GBP', mode: 'convert', rounding: 'none', status: 'removed' },
  ],
  languages: [
    { code: 'en-IN', status: 'active' },
    { code: 'hi-IN', status: 'active' },
  ],
  rates: [
    { currency: 'INR', perEuro: '100', publishedOn: '2026-10-05' },
    { currency: 'USD', perEuro: '1.2', publishedOn: '2026-10-05' },
    { currency: 'AED', perEuro: '4', publishedOn: '2026-10-05' },
    { currency: 'GBP', perEuro: '0.84', publishedOn: '2026-10-05' },
  ],
  examples: [
    { currency: 'USD', publishedOn: '2026-10-05', from: { amount: '10000', currency: 'INR' }, none: { amount: '120' }, nearest: { amount: '100' }, ends99: { amount: '199' } },
    { currency: 'AED', publishedOn: '2026-10-05', from: { amount: '10000', currency: 'INR' }, none: { amount: '400' }, nearest: { amount: '400' }, ends99: { amount: '499' } },
    { currency: 'EUR', publishedOn: '2026-10-05', from: { amount: '10000', currency: 'INR' }, none: { amount: '100' }, nearest: { amount: '100' }, ends99: { amount: '199' } },
    { currency: 'GBP', publishedOn: '2026-10-04', from: { amount: '10000', currency: 'INR' }, none: { amount: '84' }, nearest: { amount: '100' }, ends99: { amount: '199' } },
  ],
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog') as HTMLElement)

const show = async (acting: Acting = owner, readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: z.looseObject({ tab: optionalParam(z.enum(['store'])) }), component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: ['/settings'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

const card = (title: string) => within(screen.getByRole('region', { name: title }))

beforeEach(() => {
  api.loadStoreInfo.mockResolvedValue(info)
  api.loadLocale.mockResolvedValue(loc)
  api.loadTranslationProgress.mockResolvedValue(new Map([['hi-IN', { products: 40, untranslated: 12 }]]))
  api.saveStoreInfo.mockResolvedValue(undefined)
  api.saveCurrencies.mockResolvedValue(undefined)
  api.saveLanguages.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('settings', () => {
  it('are the Owner’s: anyone else is told so and nothing is read', async () => {
    await show(manager)
    expect(screen.getByRole('heading', { name: words.denied.title })).toBeTruthy()
    expect(api.loadStoreInfo).not.toHaveBeenCalled()
  })

  it('show the error with a retry that reads them again', async () => {
    api.loadStoreInfo.mockRejectedValueOnce(new Error('offline'))
    await show()
    expect(screen.getByText(words.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect((screen.getByLabelText(w.name) as HTMLInputElement).value).toBe('Kesari Threads')
  })

  it('let a read-only store look without changing anything', async () => {
    await show(owner, true)
    expect(screen.getByText(words.readOnly)).toBeTruthy()
    expect((screen.getByLabelText(w.name) as HTMLInputElement).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: w.saveInfo })).toBeNull()
    expect(screen.queryByRole('button', { name: w.saveCurrencies })).toBeNull()
  })
})

describe('store info', () => {
  it('names the address and tax fields in the home country’s words, and saves the card as typed', async () => {
    await show()
    expect(screen.getByLabelText('PIN code')).toBeTruthy()
    expect(screen.getByLabelText('GSTIN')).toBeTruthy()
    expect((screen.getByLabelText(w.countryLabel) as HTMLInputElement).readOnly).toBe(true)
    expect(screen.getByText('Next order: KT-1042')).toBeTruthy()
    expect((screen.getByRole('button', { name: w.saveInfo }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(w.prefix), { target: { value: 'kt2' } })
    fireEvent.change(screen.getByLabelText(w.units), { target: { value: 'imperial' } })
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '08ABCDE1234F1Z5' } })
    fireEvent.click(screen.getByRole('button', { name: w.saveInfo }))
    await settle()
    expect(api.saveStoreInfo).toHaveBeenCalledWith(expect.objectContaining({ name: 'Kesari Threads', orderPrefix: 'KT2', unitSystem: 'imperial', taxId: '08ABCDE1234F1Z5', nextOrderNumber: 1042, timeZone: 'Asia/Kolkata', address: info.address }))
    expect(screen.getByText(w.savedInfo)).toBeTruthy()
    // Saved is the card's new line: nothing left to save, and the tab isn't read again.
    expect((screen.getByRole('button', { name: w.saveInfo }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.loadStoreInfo).toHaveBeenCalledTimes(1)
  })

  it('keeps what’s typed in one card when another saves', async () => {
    await show()
    fireEvent.change(screen.getByLabelText(w.name), { target: { value: 'Kesari Threads & Co' } })
    const c = card(w.currencies)
    fireEvent.change(c.getByRole('combobox', { name: w.addCurrency }), { target: { value: 'GBP' } })
    fireEvent.click(c.getByRole('button', { name: w.saveCurrencies }))
    await settle()
    expect(api.saveCurrencies).toHaveBeenCalled()
    expect((screen.getByLabelText(w.name) as HTMLInputElement).value).toBe('Kesari Threads & Co')
    expect((screen.getByRole('button', { name: w.saveInfo }) as HTMLButtonElement).disabled).toBe(false)
    expect((c.getByRole('button', { name: w.saveCurrencies }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lets the next order number be cleared and retyped, and won’t save it empty', async () => {
    await show()
    const next = screen.getByLabelText(w.nextNumber) as HTMLInputElement
    fireEvent.change(next, { target: { value: '' } })
    expect(next.value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: w.saveInfo }))
    expect(api.saveStoreInfo).not.toHaveBeenCalled()
    expect(document.getElementById(next.getAttribute('aria-describedby') ?? '')?.textContent).toBe(w.nextMissing)
    fireEvent.change(next, { target: { value: '2000' } })
    fireEvent.click(screen.getByRole('button', { name: w.saveInfo }))
    await settle()
    expect(api.saveStoreInfo).toHaveBeenCalledWith(expect.objectContaining({ nextOrderNumber: 2000 }))
  })

  it('needs a name, and says why the API refused a save, keeping what was typed', async () => {
    api.saveStoreInfo.mockRejectedValue(new ApiError('INVALID_TAX_ID', 'tax'))
    await show()
    const name = screen.getByLabelText(w.name)
    fireEvent.change(name, { target: { value: ' ' } })
    // With no name the logo shows no letter, rather than one in some language.
    expect(document.querySelector('.df-set-logo-initial')?.textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: w.saveInfo }))
    expect(api.saveStoreInfo).not.toHaveBeenCalled()
    expect(document.getElementById(name.getAttribute('aria-describedby') ?? '')?.textContent).toBe(w.nameMissing)
    fireEvent.change(name, { target: { value: 'Kesari' } })
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: w.saveInfo }))
    await settle()
    expect(card(w.title).getByRole('alert').textContent).toBe(w.refused.INVALID_TAX_ID)
    expect((screen.getByLabelText('GSTIN') as HTMLInputElement).value).toBe('123')
  })

  it('uploads a new logo, and refuses one over 5 MB before sending it', async () => {
    editorApi.uploadPhoto.mockResolvedValue({ ok: true, assetId: 'a1' })
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    await show()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(6_000_000)], 'big.png', { type: 'image/png' })] } })
    expect(screen.getByText('That image is 6.0 MB — the limit is 5 MB.')).toBeTruthy()
    expect(editorApi.uploadPhoto).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } })
    await settle()
    expect(screen.getByText(w.logoNew)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: w.saveInfo }))
    await settle()
    expect(api.saveStoreInfo).toHaveBeenCalledWith(expect.objectContaining({ logoAssetId: 'a1' }))
    vi.unstubAllGlobals()
  })
})

describe('currencies', () => {
  it('show each one’s mode and a converted example at the reference rate, the removed ones left out', async () => {
    await show()
    const c = card(w.currencies)
    expect(c.getAllByRole('strong').map((x) => x.textContent)).toEqual(['INR', 'USD', 'AED'])
    expect(c.getByText(/₹100\.00 → \$1\.99 · reference rates from the European Central Bank, published Oct 5, 2026/)).toBeTruthy()
    expect(c.getByText(fill(w.typedNote, 'AED'))).toBeTruthy()
  })

  it('ask before typing prices instead of converting, then save the list as it stands', async () => {
    await show()
    const c = card(w.currencies)
    expect(c.getAllByRole('switch', { name: w.convert }).map((x) => x.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    fireEvent.click(c.getAllByRole('switch', { name: w.convert })[0] as HTMLElement)
    expect(dialog().getByText(/You’ll type a USD price on each product/)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: w.stopConfirm }))
    fireEvent.click(c.getByRole('button', { name: 'Remove AED' }))
    // Any currency with a rate can be added, the euro among them, and shows its example before it's saved.
    expect(within(c.getByRole('combobox', { name: w.addCurrency })).getByRole('option', { name: /EUR/ })).toBeTruthy()
    fireEvent.change(c.getByRole('combobox', { name: w.addCurrency }), { target: { value: 'GBP' } })
    // Dated by the rates it used, not by whichever rate the store happened to have saved.
    expect(c.getByText(/₹100\.00 → £1\.99 · reference rates from the European Central Bank, published Oct 4, 2026/)).toBeTruthy()
    fireEvent.click(c.getByRole('button', { name: w.saveCurrencies }))
    await settle()
    expect(api.saveCurrencies).toHaveBeenCalledWith([
      { code: 'USD', mode: 'manual', rounding: 'ends-99' },
      { code: 'GBP', mode: 'convert', rounding: 'ends-99' },
    ])
  })

  it('say what the plan allows when it refuses one more', async () => {
    api.saveCurrencies.mockRejectedValue(new ApiError('PLAN_LIMIT', 'limit', { key: 'currencies', limit: 3 }))
    await show()
    const c = card(w.currencies)
    fireEvent.change(c.getByRole('combobox', { name: w.addCurrency }), { target: { value: 'GBP' } })
    fireEvent.click(c.getByRole('button', { name: w.saveCurrencies }))
    await settle()
    expect(c.getByRole('alert').textContent).toBe('Your plan includes 3 currencies, your main one among them. Remove one, or see plans for more.')
  })
})

describe('languages', () => {
  it('show how much is translated, ask before removing one, and save with the main language kept', async () => {
    await show()
    const l = card(w.languages)
    expect(api.loadTranslationProgress).toHaveBeenCalledTimes(1)
    expect(api.loadTranslationProgress).toHaveBeenCalledWith(['hi-IN'])
    expect(l.getByText('28 of 40 products translated')).toBeTruthy()
    expect(l.getByText(w.mainLanguage)).toBeTruthy()
    fireEvent.change(l.getByRole('combobox', { name: w.addLanguage }), { target: { value: 'en-US' } })
    expect(l.getByText(w.notYet)).toBeTruthy()
    fireEvent.click(l.getAllByRole('button', { name: /^Remove / })[0] as HTMLElement)
    expect(dialog().getByText(w.removeLanguageBody)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: w.removeLanguage }))
    fireEvent.click(l.getByRole('button', { name: w.saveLanguages }))
    await settle()
    expect(api.saveLanguages).toHaveBeenCalledWith(['en-IN', 'en-US'], 'en-IN')
  })

  it('say when the translation count couldn’t be read', async () => {
    api.loadTranslationProgress.mockRejectedValue(new Error('offline'))
    await show()
    expect(card(w.languages).getByText(w.progressFailed)).toBeTruthy()
  })
})

function fill(template: string, code: string) {
  return template.replaceAll('{code}', code)
}
