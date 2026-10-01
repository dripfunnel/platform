import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { actionCodes, shopperActions, type ActionCode } from '../../api/activityActions'
import { messages } from '../../messages'
import { ActivityTab, type ActivityScope } from './ActivityTab'

const words = messages.activity

const render = async (scope: ActivityScope, actions: readonly ActionCode[] = actionCodes) => {
  const rootRoute = createRootRoute({
    component: () => <ActivityTab scope={scope} filter={{}} page={{}} caller="staff-support" actions={actions} onFilterChange={() => undefined} pageLink={() => null} />,
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('ActivityTab', () => {
  it('loads first, never showing a zero, and says newest first', async () => {
    const html = await render({ store: 's1' })
    expect(html).toContain('df-skeleton')
    expect(html).toContain(words.newestFirst)
    expect(html).not.toContain(words.tabEmpty.title)
  })

  it('opens the full log with the same scope, a customer by their own events', async () => {
    expect(await render({ partner: 'kl' })).toContain('href="/activity?partner=kl"')
    expect(await render({ store: 's1' })).toContain('href="/activity?store=s1"')
    expect(await render({ customer: 'c1' })).toContain('href="/activity?customer=c1"')
  })

  it("offers a customer's tab only the shopper's own actions", async () => {
    const html = await render({ customer: 'c1' }, shopperActions)
    for (const code of shopperActions) expect(html).toContain(`value="${code}"`)
    for (const code of actionCodes.filter((code) => !shopperActions.includes(code))) expect(html).not.toContain(`value="${code}"`)
  })
})
