// @vitest-environment jsdom
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route as domainsRoute } from '../../routes/_app/domains'

afterEach(cleanup)

// The real route's pending options on a stand-in with a loader the test settles: the app's own route tree needs a signed-in shell.
const open = async () => {
  let settle: () => void = () => undefined
  const loaded = new Promise<void>((resolve) => (settle = resolve))
  const { pendingMs, pendingMinMs, pendingComponent } = domainsRoute.options
  const root = createRootRoute()
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <p>home</p> })
  const domains = createRoute({ getParentRoute: () => root, path: '/domains', loader: () => loaded, pendingMs: pendingMs ?? 1000, pendingMinMs: pendingMinMs ?? 500, pendingComponent: pendingComponent ?? (() => null), component: () => <p>screen</p> })
  const router = createRouter({ routeTree: root.addChildren([home, domains]), history: createMemoryHistory({ initialEntries: ['/'] }) })
  await act(async () => void render(<RouterProvider router={router} />))
  void router.navigate({ to: '/domains' })
  return settle
}

describe('opening Domains', () => {
  it('shows its loading view as soon as the page is opened, and the screen once the addresses are in', async () => {
    const settle = await open()
    expect(await screen.findByRole('status', {}, { timeout: 300 })).toBeTruthy()
    expect(screen.queryByText('screen')).toBeNull()
    await act(async () => settle())
    expect(await screen.findByText('screen')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
