// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { actingStore, rememberActing } from '../../acting'
import type { StoreChoice } from '../../api/shell'
import { fill, messages } from '../../messages'

// Card #1136: Create another store, from the chooser and the header's switcher, through su3 and the
// building view into the new store, with each refusal worded (FIRST-RELEASE §4).

const words = messages.chooseStore.create
const su3 = messages.auth.signup.su3

const calls: { route: string; body: unknown }[] = []

/** Answers each auth route in turn from its own queue; a route asked once more than queued fails the test. */
const serve = (answers: Record<string, Record<string, unknown>[]>) => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const route = url.replace('/api/auth/', '')
    calls.push({ route, body: JSON.parse(String(init.body)) })
    const next = answers[route]?.shift()
    if (!next) throw new Error(`unexpected call to ${route}`)
    return new Response(JSON.stringify(next))
  })
}

const show = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/stores/new'] }) })
  await act(async () => {
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    )
  })
  return router
}

const settle = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))

const options = { ok: true, countries: [{ code: 'IN', name: 'India', currency: 'INR' }, { code: 'US', name: 'United States', currency: 'USD' }], shopDomain: 'my-store.one' }

const fillIn = (store: string) => {
  fireEvent.change(screen.getByLabelText(su3.store), { target: { value: store } })
  fireEvent.click(screen.getByRole('button', { name: words.primary }))
}

afterEach(() => {
  cleanup()
  calls.length = 0
  rememberActing(null)
  vi.unstubAllGlobals()
})

describe('creating another store', () => {
  it('sends the store step with no texted code, then opens the new store as the acting one', async () => {
    serve({ 'new-store/options': [options, options], 'new-store': [{ ok: true, step: 'done', storeId: 'store-new' }] })
    const { NewStore } = await import('./NewStore')
    const router = await show(<NewStore />)
    await settle()
    fireEvent.change(screen.getByLabelText(su3.store), { target: { value: 'Kesari Home' } })
    expect(screen.getByText(fill(su3.subHelp, { address: 'kesari-home.my-store.one' }))).toBeTruthy()
    fillIn('Kesari Home')
    await settle()
    expect(calls.find((c) => c.route === 'new-store')?.body).toEqual({ storeName: 'Kesari Home', subdomain: 'kesari-home', country: 'IN' })
    expect(screen.getByText(fill(messages.auth.signup.building.title, { store: 'Kesari Home' }))).toBeTruthy()
    await settle(1300)
    expect(actingStore()).toEqual({ storeId: 'store-new', supplierId: null })
    expect(router.state.location.pathname).toBe('/home')
    expect(calls.some((c) => c.route.startsWith('sign-up'))).toBe(false)
  })

  it('sends a new Owner without two-step sign-in to set it up first', async () => {
    serve({ 'new-store/options': [options, options], 'new-store': [{ ok: true, step: 'enrol', storeId: 'store-new' }] })
    const { NewStore } = await import('./NewStore')
    const router = await show(<NewStore />)
    await settle()
    fillIn('Kesari Home')
    await settle()
    await settle(1300)
    expect(actingStore()).toEqual({ storeId: 'store-new', supplierId: null })
    expect(router.state.location.pathname).toBe('/sign-in')
    expect(router.state.location.search).toEqual({ step: 'enrol', next: '/home' })
  })

  it('words a taken address, a support session and the day’s limit, and checks the name before asking', async () => {
    serve({ 'new-store/options': [options, options], 'new-store': [{ ok: false, code: 'SUBDOMAIN_TAKEN', suggestions: ['kesari-co'] }, { ok: false, code: 'FORBIDDEN' }, { ok: false, code: 'DAILY_LIMIT' }] })
    const { NewStore } = await import('./NewStore')
    await show(<NewStore />)
    await settle()
    fillIn(' ')
    await settle()
    expect(screen.getByText(su3.nameMissing)).toBeTruthy()
    fillIn('Kesari')
    await settle()
    expect(screen.getByText(fill(su3.taken, { suggestions: 'kesari-co' }))).toBeTruthy()
    fillIn('Kesari')
    await settle()
    expect(screen.getByText(words.forbidden)).toBeTruthy()
    fillIn('Kesari')
    await settle()
    expect(screen.getByText(words.dailyLimit)).toBeTruthy()
    expect(calls.filter((c) => c.route === 'new-store')).toHaveLength(3)
  })

  it('says when the partner takes no new stores, sends a signed-out person to sign in, and goes back to the stores', async () => {
    serve({ 'new-store/options': [{ ok: false, code: 'SIGNUP_CLOSED' }, { ok: false, code: 'SIGNUP_CLOSED' }] })
    const { NewStore } = await import('./NewStore')
    const router = await show(<NewStore />)
    await settle()
    expect(screen.getByText(messages.auth.signup.su1.closed)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.back) }))
    await settle()
    expect(router.state.location.pathname).toBe('/stores')
    cleanup()
    serve({ 'new-store/options': [{ ok: false, code: 'INVALID_CREDENTIALS' }, { ok: false, code: 'INVALID_CREDENTIALS' }] })
    const signedOut = await show(<NewStore />)
    await settle()
    expect(signedOut.state.location.pathname).toBe('/sign-in')
    expect(signedOut.state.location.search).toEqual({ next: '/stores/new' })
  })
})

describe('the store switcher', () => {
  it('offers Create another store as its last item, even to someone in one store', async () => {
    const { StoreSwitcher } = await import('../shell/StoreSwitcher')
    const only: StoreChoice = { membershipId: 'm1', store: { id: 's1', name: 'Juniper & Co.' }, role: 'owner', tier: null, seller: null }
    const router = await show(<StoreSwitcher current={only} stores={[only]} />)
    fireEvent.click(screen.getByRole('button', { name: fill(messages.shell.switcher.label, { store: 'Juniper & Co.' }) }))
    const items = [...document.querySelectorAll('[role^="menuitem"]')]
    expect(items.at(-1)?.textContent).toContain(words.action)
    fireEvent.click(screen.getByRole('menuitem', { name: words.action }))
    await settle()
    expect(router.state.location.pathname).toBe('/stores/new')
  })
})
