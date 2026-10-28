// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreAiAccount } from '../../api/aiAccount'
import type { Acting } from '../../api/shell'
import type { StorefrontBrand, StorefrontDomains, StorefrontOverview, StorefrontSeo } from '../../api/storefront'
import { messages } from '../../messages'
import { storefrontSearch } from './storefrontSearch'

// Storefront › AI driven as the Owner would (SetAi): sign in with ChatGPT or connect a key once, then only its prefix; test, the switch, remove.

const w = messages.storefront.ai

const ai = vi.hoisted(() => ({
  aiProviders: ['anthropic', 'openai'],
  loadStoreAiAccount: vi.fn(),
  loadStoreAiSignIn: vi.fn(),
  loadPlanRuns: vi.fn(),
  connectStoreAiAccount: vi.fn(),
  beginStoreAiOauth: vi.fn(),
  finishStoreAiOauth: vi.fn(),
  testStoreAiAccount: vi.fn(),
  setStoreAiSwitch: vi.fn(),
  removeStoreAiAccount: vi.fn(),
}))
vi.mock('../../api/aiAccount', () => ai)
const sf = vi.hoisted(() => ({ loadBrand: vi.fn(), loadSeo: vi.fn(), loadDomains: vi.fn(), loadOverview: vi.fn(), loadTemplates: vi.fn(), loadMeters: vi.fn() }))
vi.mock('../../api/storefront', async (actual) => ({ ...(await actual<typeof import('../../api/storefront')>()), ...sf }))

const { StorefrontPage } = await import('./StorefrontPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['storefront.read', 'publish', 'settings'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['storefront.read'] }

const none = { instagram: null, facebook: null, x: null, youtube: null, tiktok: null, whatsapp: null }
const brand: StorefrontBrand = { brandReady: true, shopName: 'Kesari Threads', logoAssetId: 'a-logo', faviconAssetId: null, primaryColour: null, secondaryColour: null, tagline: null, description: null, social: none, contactEmail: 'hello@kesari.in', contactPhone: null, contactAddress: null, voice: null }
const seo: StorefrontSeo = { title: 'Kesari Threads', description: null, shareImageAssetId: null }
const domains: StorefrontDomains = { customDomainAllowed: true, domains: [{ id: null, host: 'kesari.shops.example.com', kind: 'free', status: 'live', primary: true, checkedAt: null, records: [] }] }
const overview: StorefrontOverview = { status: 'same_as_live', template: 'linen', live: { number: 12, publishedAt: '2026-10-09T10:40:00Z', template: 'linen', portalOrigin: null }, draft: null, lastPublish: null }

const account = (over: Partial<StoreAiAccount> = {}): StoreAiAccount => ({ provider: 'anthropic', keyPrefix: 'sk-ant-api03-Qx', status: 'ok', lastTestedAt: '2026-10-11T10:44:00Z', useWhenPlanUsed: false, connectedBy: 'Farhan Ali', authType: 'api_key', accountLabel: null, ...over })
const signedIn = (over: Partial<StoreAiAccount> = {}) => account({ provider: 'openai', keyPrefix: '', authType: 'oauth', accountLabel: 'ada@example.com', ...over })
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog[open]') as HTMLElement)

const show = async ({ acting = owner, readOnly = false, entry = '/storefront?tab=ai' } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/storefront', validateSearch: storefrontSearch, component: StorefrontPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: [entry] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
  return router
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
  sf.loadBrand.mockResolvedValue(brand)
  sf.loadSeo.mockResolvedValue(seo)
  sf.loadDomains.mockResolvedValue(domains)
  sf.loadOverview.mockResolvedValue(overview)
  sf.loadTemplates.mockResolvedValue([])
  sf.loadMeters.mockResolvedValue(null)
  ai.loadStoreAiAccount.mockResolvedValue(account())
  ai.loadStoreAiSignIn.mockResolvedValue({ anthropic: true, openai: true })
  ai.loadPlanRuns.mockResolvedValue({ used: 38, allowed: 50 })
  ai.connectStoreAiAccount.mockResolvedValue(undefined)
  ai.beginStoreAiOauth.mockResolvedValue('https://auth.openai.example.com/authorize?x=1')
  ai.finishStoreAiOauth.mockResolvedValue(undefined)
  ai.testStoreAiAccount.mockResolvedValue('ok')
  ai.setStoreAiSwitch.mockResolvedValue(undefined)
  ai.removeStoreAiAccount.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('Storefront › AI', () => {
  it('shows the account by its prefix only, with its status, and the plan runs used', async () => {
    await show()
    expect(screen.getByText('sk-ant-api03-Qx…')).toBeTruthy()
    expect(screen.getByText(w.status.ok)).toBeTruthy()
    expect(screen.getByText('38 of 50 used this month')).toBeTruthy()
    expect(screen.queryByLabelText(w.key.key)).toBeNull()
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false)
  })

  it('connects a key, empties the field and reads the account again', async () => {
    ai.loadStoreAiAccount.mockResolvedValueOnce(null).mockResolvedValue(account({ provider: 'openai', keyPrefix: 'sk-proj-abc' }))
    await show()
    fireEvent.click(screen.getByRole('button', { name: w.key.go }))
    expect(screen.getByRole('alert').textContent).toBe(w.key.missing)
    expect(ai.connectStoreAiAccount).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(w.key.provider), { target: { value: 'openai' } })
    fireEvent.change(screen.getByLabelText(w.key.key), { target: { value: ' sk-proj-abcdef ' } })
    fireEvent.click(screen.getByRole('button', { name: w.key.go }))
    await settle()
    expect(ai.connectStoreAiAccount).toHaveBeenCalledWith('openai', 'sk-proj-abcdef')
    expect(screen.getByText('sk-proj-abc…')).toBeTruthy()
    expect(screen.getByText(w.connect.done)).toBeTruthy()
    expect(screen.queryByDisplayValue('sk-proj-abcdef')).toBeNull()
  })

  it('says the provider rejected a key, and keeps nothing', async () => {
    ai.loadStoreAiAccount.mockResolvedValue(null)
    ai.connectStoreAiAccount.mockRejectedValue(new ApiError('KEY_REJECTED', 'x'))
    await show()
    fireEvent.change(screen.getByLabelText(w.key.key), { target: { value: 'sk-ant-bad' } })
    fireEvent.click(screen.getByRole('button', { name: w.key.go }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(w.refused.KEY_REJECTED)
    expect(screen.getByRole('button', { name: w.key.go })).toBeTruthy()
  })

  it('tests the key and shows a rejected one with what stops', async () => {
    ai.testStoreAiAccount.mockResolvedValue('rejected')
    ai.loadStoreAiAccount.mockResolvedValueOnce(account()).mockResolvedValue(account({ status: 'rejected' }))
    await show()
    fireEvent.click(screen.getByRole('button', { name: w.account.test }))
    await settle()
    expect(screen.getByText(w.status.rejected)).toBeTruthy()
    expect(screen.getByText(/no longer accepts this key/)).toBeTruthy()
  })

  it('turns the switch on and off, saying so', async () => {
    ai.loadStoreAiAccount.mockResolvedValueOnce(account()).mockResolvedValue(account({ useWhenPlanUsed: true }))
    await show()
    fireEvent.click(screen.getByRole('switch'))
    await settle()
    expect(ai.setStoreAiSwitch).toHaveBeenCalledWith(true)
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(w.switch.turnedOn)).toBeTruthy()
  })

  it('removes the account only after its consequence is confirmed', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: w.account.remove }))
    expect(dialog().getByText(w.account.removeBody)).toBeTruthy()
    expect(ai.removeStoreAiAccount).not.toHaveBeenCalled()
    fireEvent.click(dialog().getByRole('button', { name: w.account.removeGo }))
    await settle()
    expect(ai.removeStoreAiAccount).toHaveBeenCalledOnce()
    expect(screen.getByLabelText(w.key.key)).toBeTruthy()
  })

  it('is look-only when the store is read-only', async () => {
    await show({ readOnly: true })
    expect((screen.getByRole('button', { name: w.account.test }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(true)
  })

  it('still lets the Owner connect an account while the store is view-only', async () => {
    ai.loadStoreAiAccount.mockResolvedValue(null)
    await show({ readOnly: true })
    expect((screen.getByRole('button', { name: w.chatgpt.go }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: w.claude.go }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: w.key.go }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByLabelText(w.key.provider) as HTMLSelectElement).disabled).toBe(false)
  })

  it('has no AI tab for a Manager, who still reads the rest of Storefront', async () => {
    await show({ acting: manager })
    expect(screen.queryByRole('tab', { name: messages.storefront.tabs.ai })).toBeNull()
    expect(ai.loadStoreAiAccount).not.toHaveBeenCalled()
    expect(screen.getByText(w.denied.title)).toBeTruthy()
  })

  it('leaves the plan card out when its read fails, and shows the error when the account read fails', async () => {
    ai.loadPlanRuns.mockRejectedValue(new Error('x'))
    await show()
    expect(screen.queryByText(w.plan.title)).toBeNull()
    expect(screen.getByText('sk-ant-api03-Qx…')).toBeTruthy()
    cleanup()
    ai.loadStoreAiAccount.mockRejectedValue(new Error('x'))
    await show()
    expect(screen.getByText(w.error.title)).toBeTruthy()
  })

  it('offers both sign-ins', async () => {
    ai.loadStoreAiAccount.mockResolvedValue(null)
    await show()
    const claude = screen.getByRole('region', { name: w.claude.title })
    expect((within(claude).getByRole('button', { name: w.claude.go }) as HTMLButtonElement).disabled).toBe(false)
    const chatgpt = screen.getByRole('region', { name: w.chatgpt.title })
    expect((within(chatgpt).getByRole('button', { name: w.chatgpt.go }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("shows each provider's terms risk before the sign-in is used, and none where it is off", async () => {
    ai.loadStoreAiAccount.mockResolvedValue(null)
    ai.loadStoreAiSignIn.mockResolvedValue({ anthropic: true, openai: false })
    await show()
    expect(within(screen.getByRole('region', { name: w.claude.title })).getByText(w.claude.risk)).toBeTruthy()
    expect(screen.queryByText(w.chatgpt.risk)).toBeNull()
    expect(ai.beginStoreAiOauth).not.toHaveBeenCalled()
  })

  it('says so and disables a sign-in the API does not offer', async () => {
    ai.loadStoreAiAccount.mockResolvedValue(null)
    ai.loadStoreAiSignIn.mockResolvedValue({ anthropic: true, openai: false })
    await show()
    const chatgpt = screen.getByRole('region', { name: w.chatgpt.title })
    expect(within(chatgpt).getByText(w.signIn.off)).toBeTruthy()
    expect((within(chatgpt).getByRole('button', { name: w.chatgpt.go }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('refuses to open an address that is not https', async () => {
    ai.loadStoreAiAccount.mockResolvedValue(null)
    ai.beginStoreAiOauth.mockResolvedValue('http://auth.openai.example.com/authorize')
    await show()
    fireEvent.click(screen.getByRole('button', { name: w.chatgpt.go }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(w.signIn.badLink)
  })

  it('opens the provider in a new tab, takes the pasted code once, then shows the account', async () => {
    ai.loadStoreAiAccount.mockResolvedValueOnce(null).mockResolvedValue(signedIn())
    ai.beginStoreAiOauth.mockResolvedValue('https://auth.openai.example.com/authorize?state=x')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await show()
    fireEvent.click(screen.getByRole('button', { name: w.chatgpt.go }))
    await settle()
    expect(ai.beginStoreAiOauth).toHaveBeenCalledWith('openai')
    expect(open).toHaveBeenCalledWith('https://auth.openai.example.com/authorize?state=x', '_blank', 'noopener,noreferrer')
    fireEvent.click(screen.getByRole('button', { name: w.signIn.finish }))
    expect(screen.getByRole('alert').textContent).toBe(w.signIn.missing)
    expect(ai.finishStoreAiOauth).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(w.signIn.pasteLabel), { target: { value: ' code123#state456 ' } })
    fireEvent.click(screen.getByRole('button', { name: w.signIn.finish }))
    await settle()
    expect(ai.finishStoreAiOauth).toHaveBeenCalledOnce()
    expect(ai.finishStoreAiOauth).toHaveBeenCalledWith('code123#state456')
    expect(screen.getByText('ada@example.com')).toBeTruthy()
    open.mockRestore()
  })

  it('starts Claude\'s sign-in the same way, and says so when the pasted code is refused', async () => {
    ai.loadStoreAiAccount.mockResolvedValue(null)
    ai.beginStoreAiOauth.mockResolvedValue('https://claude.example.com/authorize?state=x')
    ai.finishStoreAiOauth.mockRejectedValue(new ApiError('OAUTH_EXPIRED', 'x'))
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await show()
    fireEvent.click(screen.getByRole('button', { name: w.claude.go }))
    await settle()
    expect(ai.beginStoreAiOauth).toHaveBeenCalledWith('anthropic')
    fireEvent.change(screen.getByLabelText(w.signIn.pasteLabel), { target: { value: 'bad#code' } })
    fireEvent.click(screen.getByRole('button', { name: w.signIn.finish }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(w.refused.OAUTH_EXPIRED)
    open.mockRestore()
  })

  it('shows a signed-in account by its label, with Reconnect and Disconnect', async () => {
    ai.loadStoreAiAccount.mockResolvedValue(signedIn())
    await show()
    expect(screen.getByText('ada@example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: w.signIn.reconnect })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: w.signIn.disconnect }))
    expect(dialog().getByText(messages.storefront.ai.signIn.removeBody.replace('{provider}', w.signInProviders.openai))).toBeTruthy()
  })

  it('shows an expired sign-in as needing a reconnect when its test says so', async () => {
    ai.loadStoreAiAccount.mockResolvedValue(signedIn())
    ai.testStoreAiAccount.mockRejectedValue(new ApiError('OAUTH_EXPIRED', 'x'))
    await show()
    fireEvent.click(screen.getByRole('button', { name: w.account.test }))
    await settle()
    expect(screen.getByText(w.status.expired)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(w.refused.OAUTH_EXPIRED)
  })
})
