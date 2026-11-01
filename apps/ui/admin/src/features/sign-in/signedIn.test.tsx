// @vitest-environment happy-dom
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real routes (#1122): signed-in staff never get the sign-in page.

const me = vi.hoisted(() => ({ loadMe: vi.fn() }))
vi.mock('../../api/me', async (actual) => ({ ...(await actual<typeof import('../../api/me')>()), ...me }))

const { routeTree } = await import('../../routeTree.gen')

const landOn = async (path: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return `${router.state.location.pathname}${router.state.location.searchStr}`
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('the sign-in page for staff already signed in', () => {
  it('sends sign-in on to the dashboard', async () => {
    me.loadMe.mockResolvedValue({ id: 's1', name: 'Ada', email: 'ada@dripfunnel.ai', role: 'staff-super-admin' })
    expect(await landOn('/sign-in')).toBe('/dashboard')
  })

  it('keeps the page when nobody is signed in, the read fails, or a preview state is asked for', async () => {
    me.loadMe.mockResolvedValue(null)
    expect(await landOn('/sign-in')).toBe('/sign-in')
    me.loadMe.mockRejectedValue(new Error('offline'))
    expect(await landOn('/sign-in')).toBe('/sign-in')
    me.loadMe.mockResolvedValue({ id: 's1', name: 'Ada', email: 'ada@dripfunnel.ai', role: 'staff-super-admin' })
    expect(await landOn('/sign-in?state=refused')).toBe('/sign-in?state=refused')
  })
})
