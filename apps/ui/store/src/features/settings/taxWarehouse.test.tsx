// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { optionalParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Acting } from '../../api/shell'
import type { TaxSetupFull } from '../../api/tax'
import { messages } from '../../messages'

// Settings › Warehouse and Tax setup driven as the Owner would (SetOps, CatSettings' tax tab).

const t = messages.settings.tax
const wh = messages.warehouses

const tax = vi.hoisted(() => ({ loadTax: vi.fn(), setPricesIncludeTax: vi.fn(), saveTaxClass: vi.fn(), deleteTaxClass: vi.fn(), saveTaxZone: vi.fn(), loadInvoiceSettings: vi.fn(), saveInvoiceSettings: vi.fn() }))
vi.mock('../../api/tax', () => tax)
const settings = vi.hoisted(() => ({ loadStoreInfo: vi.fn(), loadLocale: vi.fn() }))
vi.mock('../../api/settings', () => settings)
const team = vi.hoisted(() => ({ loadSuppliers: vi.fn() }))
vi.mock('../../api/team', async (actual) => ({ ...(await actual<typeof import('../../api/team')>()), ...team }))
const stock = vi.hoisted(() => ({ loadPlaces: vi.fn(), savePlace: vi.fn(), makeDefaultPlace: vi.fn(), deletePlace: vi.fn() }))
vi.mock('../../api/stock', async (actual) => ({ ...(await actual<typeof import('../../api/stock')>()), ...stock }))

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'settings', 'stock.read', 'warehouses.write'] }

const setup: TaxSetupFull = {
  pricesIncludeTax: true,
  classes: [
    { id: 'c12', name: 'Clothing', isDefault: true, taxCode: null, versions: 41 },
    { id: 'c18', name: 'Home décor', isDefault: false, taxCode: null, versions: 9 },
    { id: 'c0', name: 'Exempt', isDefault: false, taxCode: null, versions: 0 },
  ],
  zones: [
    { id: 'z-in', name: 'India', countries: ['IN'], regions: [], rates: [{ taxClassId: 'c12', rateBps: 1200 }, { taxClassId: 'c18', rateBps: 1800 }] },
    { id: 'z-ae', name: 'UAE', countries: ['AE'], regions: [], rates: [{ taxClassId: 'c12', rateBps: 500 }] },
  ],
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog') as HTMLElement)
const confirm = (name: string) => fireEvent.click(dialog().getByRole('button', { name }))

const show = async (tab: 'warehouse' | 'tax') => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting: owner, state: { readOnly: false } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: z.looseObject({ tab: optionalParam(z.enum(['store', 'people', 'supplier', 'warehouse', 'tax'])) }), component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: [`/settings?tab=${tab}`] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

const region = (name: string) => within(screen.getByRole('region', { name }))

beforeEach(() => {
  tax.loadTax.mockResolvedValue(setup)
  tax.loadInvoiceSettings.mockResolvedValue({ taxPerLine: true, emailWithDispatch: true, footer: 'Thank you', legalName: null })
  settings.loadStoreInfo.mockResolvedValue({ country: 'IN', taxId: '08ABCDE1234F1Z5' })
  settings.loadLocale.mockResolvedValue({ pricingCurrency: 'INR' })
  for (const fn of [tax.setPricesIncludeTax, tax.deleteTaxClass, tax.saveInvoiceSettings]) fn.mockResolvedValue(undefined)
  tax.saveTaxClass.mockResolvedValue('c-new')
  tax.saveTaxZone.mockResolvedValue('z-in')
  team.loadSuppliers.mockResolvedValue([{ id: 'v1', name: 'Northwind Textiles' }])
  stock.loadPlaces.mockResolvedValue([
    { id: 'w1', name: 'Workshop', isDefault: true, units: 30, revision: 1, address: null, supplierId: null },
    { id: 'w9', name: 'Northwind godown', isDefault: true, units: 12, revision: 1, address: null, supplierId: 'v1' },
  ])
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('warehouse', () => {
  it('lists the store’s locations to manage, and its suppliers’ apart, named and read-only', async () => {
    await show('warehouse')
    expect(screen.getByRole('button', { name: 'Manage Workshop' })).toBeTruthy()
    const theirs = region(wh.theirsTitle)
    expect(theirs.getByText('Northwind godown')).toBeTruthy()
    expect(theirs.getByText(/Northwind Textiles · 12 units/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Manage Northwind godown' })).toBeNull()
  })

  it('shows the error with a retry when the suppliers don’t load', async () => {
    team.loadSuppliers.mockRejectedValueOnce(new Error('offline'))
    await show('warehouse')
    expect(screen.getByText(messages.settings.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: messages.settings.error.retry }))
    await settle()
    await settle()
    expect(screen.getByRole('button', { name: 'Manage Workshop' })).toBeTruthy()
  })
})

describe('tax setup', () => {
  it('shows what a typed price means at the default rate, and switches after saying the numbers stay', async () => {
    await show('tax')
    expect(screen.getByText('You type ₹1,000.00 → shopper pays ₹1,000.00, of which ₹107.14 is GST')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Prices don’t include GST/ }))
    fireEvent.click(region(t.pricesTitle).getByRole('button', { name: t.save }))
    expect(dialog().getByText(/The numbers you typed on your products stay as they are/)).toBeTruthy()
    confirm(t.save)
    await settle()
    expect(tax.setPricesIncludeTax).toHaveBeenCalledWith(false)
    expect(screen.getByText('Prices now exclude GST — it’s added at checkout')).toBeTruthy()
  })

  it('lists the categories with their rate at home, and the rates elsewhere', async () => {
    await show('tax')
    const c = region('Your tax rates')
    expect(c.getByText('12% · default for new products')).toBeTruthy()
    expect(c.getByText('18%')).toBeTruthy()
    expect(c.getByText(t.noRate)).toBeTruthy()
    expect(region(t.otherPlaces).getByText('Clothing 5%')).toBeTruthy()
  })

  it('makes a category the default, changes a rate at home, adds one with its rate, and deletes an unused one', async () => {
    await show('tax')
    fireEvent.click(screen.getByRole('button', { name: 'Manage Home décor' }))
    confirm(t.continue)
    await settle()
    expect(tax.saveTaxClass).toHaveBeenLastCalledWith('c18', { name: 'Home décor', taxCode: null, isDefault: true })
    fireEvent.click(screen.getByRole('button', { name: 'Manage Clothing' }))
    confirm(t.continue)
    fireEvent.change(dialog().getByLabelText(t.rateLabel), { target: { value: '5' } })
    confirm(t.save)
    await settle()
    expect(tax.saveTaxZone).toHaveBeenLastCalledWith('z-in', { name: 'India', countries: ['IN'], regions: [], rates: [{ taxClassId: 'c18', rateBps: 1800 }, { taxClassId: 'c12', rateBps: 500 }] })
    fireEvent.click(screen.getByRole('button', { name: t.addTitle }))
    fireEvent.change(dialog().getByLabelText(t.addLabel), { target: { value: 'Books 7.5%' } })
    confirm(t.add)
    await settle()
    expect(tax.saveTaxClass).toHaveBeenLastCalledWith(null, { name: 'Books', taxCode: null, isDefault: false })
    expect(tax.saveTaxZone).toHaveBeenLastCalledWith('z-in', expect.objectContaining({ rates: expect.arrayContaining([{ taxClassId: 'c-new', rateBps: 750 }]) }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage Exempt' }))
    fireEvent.change(dialog().getByRole('combobox'), { target: { value: 'delete' } })
    confirm(t.continue)
    confirm(t.delete)
    await settle()
    expect(tax.deleteTaxClass).toHaveBeenCalledWith('c0')
    expect(tax.loadTax.mock.calls.length).toBeGreaterThan(3)
  })

  it('says why a category change was refused', async () => {
    tax.saveTaxClass.mockRejectedValue(new ApiError('DUPLICATE_NAME', 'dup'))
    await show('tax')
    fireEvent.click(screen.getByRole('button', { name: t.addTitle }))
    fireEvent.change(dialog().getByLabelText(t.addLabel), { target: { value: 'Clothing 12' } })
    confirm(t.add)
    await settle()
    expect(region('Your tax rates').getByRole('alert').textContent).toBe(t.refused.DUPLICATE_NAME)
  })

  it('leaves a US store’s rates to the shopper’s state, with nothing to add', async () => {
    settings.loadStoreInfo.mockResolvedValue({ country: 'US', taxId: null })
    settings.loadLocale.mockResolvedValue({ pricingCurrency: 'USD' })
    tax.loadTax.mockResolvedValue({ ...setup, pricesIncludeTax: false, zones: [] })
    await show('tax')
    expect(region('Your tax categories').getAllByText(new RegExp(t.byState)).length).toBe(3)
    expect(screen.queryByRole('button', { name: t.addTitle })).toBeNull()
    expect(screen.getByText(t.invoiceNoTaxId)).toBeTruthy()
  })

  it('saves the invoice settings, keeping the footer as it is', async () => {
    await show('tax')
    fireEvent.click(screen.getByLabelText('Show GST on each line, not just the total'))
    fireEvent.click(screen.getByRole('button', { name: t.saveInvoice }))
    await settle()
    expect(tax.saveInvoiceSettings).toHaveBeenCalledWith({ taxPerLine: false, emailWithDispatch: true, footer: 'Thank you' })
    expect(screen.getByText(t.invoiceSaved)).toBeTruthy()
  })
})
