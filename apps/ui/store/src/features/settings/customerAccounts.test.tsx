// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerAccounts } from '../../api/customerAccounts'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { settingsSearch } from './settingsSearch'

// Settings › Customer accounts driven as the Owner would (SetAccess "customers"; ACCESS §2.1).

const w = messages.settings.customers

const accounts = vi.hoisted(() => ({ loadCustomerAccounts: vi.fn(), saveCustomerAccounts: vi.fn() }))
vi.mock('../../api/customerAccounts', async (actual) => ({ ...(await actual<typeof import('../../api/customerAccounts')>()), ...accounts }))
const settings = vi.hoisted(() => ({ loadStoreInfo: vi.fn(), loadLocale: vi.fn() }))
vi.mock('../../api/settings', () => settings)

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['settings'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['orders.read', 'customers.read'] }
const both: CustomerAccounts = { mode: 'both', customers: 1284, withEmail: 812, withPhone: 686, phoneOnly: 214 }

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async ({ acting = owner, readOnly = false } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: settingsSearch, component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: ['/settings?tab=customers'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(name) }) as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: w.save }) as HTMLButtonElement

beforeEach(() => {
  accounts.loadCustomerAccounts.mockResolvedValue(both)
  settings.loadStoreInfo.mockResolvedValue({ country: 'IN' })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('customer accounts', () => {
  it('shows how shoppers sign in now, what they see and how many accounts each way', async () => {
    await show()
    expect(radio(w.modes.both.label).checked).toBe(true)
    expect(screen.getByText(/Most shops in India choose this/)).toBeTruthy()
    expect(screen.getByText(w.see.both)).toBeTruthy()
    expect(screen.getByText(/Codes are sent through .*\(MSG91\)/)).toBeTruthy()
    expect(screen.getByText('1,284 customer accounts · 812 with email · 686 with a mobile number')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
  })

  it('warns with their count that phone-only shoppers can’t sign in once mobile goes, then saves', async () => {
    accounts.saveCustomerAccounts.mockResolvedValue({ ...both, mode: 'email' })
    await show()
    fireEvent.click(radio(w.modes.email.label))
    expect(screen.getByText('214 customers have only a mobile number. They keep their accounts and orders, but can’t sign in while your storefront takes email only.')).toBeTruthy()
    expect(screen.getByText(w.see.email)).toBeTruthy()
    expect(screen.queryByText(/Codes are sent through/)).toBeNull()
    fireEvent.click(saveButton())
    await settle()
    expect(accounts.saveCustomerAccounts).toHaveBeenCalledWith('email')
    expect(screen.getByText(w.saved)).toBeTruthy()
    // Saved: email only is what's on now, so there is nothing left to warn about.
    expect(screen.queryByText(/have only a mobile number/)).toBeNull()
    expect(saveButton().disabled).toBe(true)
  })

  it('doesn’t warn when no shopper has only a mobile number, and names Twilio for a US store', async () => {
    accounts.loadCustomerAccounts.mockResolvedValue({ ...both, phoneOnly: 0 })
    settings.loadStoreInfo.mockResolvedValue({ country: 'US' })
    await show()
    expect(screen.queryByText(/Most shops in India/)).toBeNull()
    expect(screen.getByText(/\(Twilio\)/)).toBeTruthy()
    fireEvent.click(radio(w.modes.email.label))
    expect(screen.queryByText(/only a mobile number/)).toBeNull()
  })

  it('says why a save was refused, on the card, keeping the choice', async () => {
    accounts.saveCustomerAccounts.mockRejectedValue(new ApiError('READ_ONLY', 'ro'))
    await show()
    fireEvent.click(radio(w.modes.mobile.label))
    fireEvent.click(saveButton())
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(w.refused.READ_ONLY)
    expect(radio(w.modes.mobile.label).checked).toBe(true)
  })

  it('lets a read-only store look without choosing or saving', async () => {
    await show({ readOnly: true })
    expect(radio(w.modes.email.label).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: w.save })).toBeNull()
  })

  it('reads nothing for anyone but the Owner', async () => {
    await show({ acting: staff })
    expect(screen.getByText(messages.settings.denied.title)).toBeTruthy()
    expect(accounts.loadCustomerAccounts).not.toHaveBeenCalled()
  })
})
