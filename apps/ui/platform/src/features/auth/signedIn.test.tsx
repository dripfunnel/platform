// @vitest-environment happy-dom
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real routes (#1122): a signed-in partner user never gets the sign-in page.

const me = vi.hoisted(() => ({ loadMe: vi.fn() }))
vi.mock('../../api/me', async (actual) => ({ ...(await actual<typeof import('../../api/me')>()), ...me }))

const { routeTree } = await import('../../routeTree.gen')

const landOn = async (path: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return `${router.state.location.pathname}${router.state.location.searchStr}`
}

const signedIn = () => me.loadMe.mockResolvedValue({ id: 'u1', name: 'Ada', email: 'ada@northstar.example', role: 'partner-owner', partner: { id: 'pa1', name: 'Northstar', product: 'Northstar Commerce', host: null, state: 'active' } })

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('the sign-in page for someone already signed in', () => {
  it('sends sign-in on to the dashboard, or to its own next on this app', async () => {
    signedIn()
    expect(await landOn('/sign-in')).toBe('/dashboard')
    expect(await landOn('/sign-in?next=%2Fstores')).toBe('/stores')
    expect(await landOn('/sign-in?next=https%3A%2F%2Fevil.example%2F')).toBe('/dashboard')
  })

  it.each(['/reset-password', '/accept-invite'])('leaves %s, a page a link opens, where it is', async (path) => {
    signedIn()
    expect(await landOn(path)).toBe(path)
  })

  it('keeps the page when nobody is signed in, the read fails, or a preview state is asked for', async () => {
    me.loadMe.mockResolvedValue(null)
    expect(await landOn('/sign-in')).toBe('/sign-in')
    me.loadMe.mockRejectedValue(new Error('offline'))
    expect(await landOn('/sign-in')).toBe('/sign-in')
    signedIn()
    expect(await landOn('/sign-in?state=expired')).toBe('/sign-in?state=expired')
  })
})
