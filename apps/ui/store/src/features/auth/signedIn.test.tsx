// @vitest-environment happy-dom
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real routes (#1122): a signed-in person never gets sign-in, Forgot password or sign-up.

const shell = vi.hoisted(() => ({ loadMe: vi.fn(), readShell: vi.fn() }))
vi.mock('../../api/shell', async (actual) => ({ ...(await actual<typeof import('../../api/shell')>()), ...shell }))

const { routeTree } = await import('../../routeTree.gen')

const landOn = async (path: string) => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return `${router.state.location.pathname}${router.state.location.searchStr}`
}

const signedIn = () => shell.loadMe.mockResolvedValue({ id: 'u1', name: 'Ada', email: 'ada@example.com', acting: null })

beforeEach(() => {
  shell.readShell.mockRejectedValue(new Error('not in this test'))
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('sign-in pages for someone already signed in', () => {
  it.each(['/sign-in', '/sign-in?view=forgot', '/sign-up'])('sends %s on to Home', async (path) => {
    signedIn()
    expect(await landOn(path)).toBe('/home')
  })

  it('sends sign-in on to its own next, and never off this app', async () => {
    signedIn()
    expect(await landOn('/sign-in?next=%2Forders')).toBe('/orders')
    expect(await landOn('/sign-in?next=https%3A%2F%2Fevil.example%2F')).toBe('/home')
  })

  it.each(['/confirm-email', '/reset-password', '/accept-invite', '/join'])('leaves %s, a page a link opens, where it is', async (path) => {
    signedIn()
    expect(await landOn(path)).toBe(path)
  })

  it('keeps the page when nobody is signed in, the read fails, or a preview state is asked for', async () => {
    shell.loadMe.mockResolvedValue(null)
    expect(await landOn('/sign-in')).toBe('/sign-in')
    expect(await landOn('/sign-in?step=second-factor&method=sms')).toBe('/sign-in?step=second-factor&method=sms')
    expect(await landOn('/sign-up?step=store')).toBe('/sign-up?step=store')
    shell.loadMe.mockRejectedValue(new Error('offline'))
    expect(await landOn('/sign-in')).toBe('/sign-in')
    signedIn()
    expect(await landOn('/sign-in?state=expired')).toBe('/sign-in?state=expired')
  })
})
