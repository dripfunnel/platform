import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createSampleServer, samplePartners } from '../../api/partnersSample'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { Approvals, type ApprovalsProps } from './Approvals'

const words = messages.approvals
const noop = () => undefined
const queue = () => createSampleServer(samplePartners).list({ status: 'awaiting', sort: 'oldestSubmitted' }, {}, 25, 'staff-super-admin')

const render = async (props: Partial<ApprovalsProps> = {}) => {
  const rootRoute = createRootRoute({ component: () => <Approvals page={queue()} forced={null} onReload={noop} {...props} /> })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/approvals'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('Approvals', () => {
  it('shows who set the partner up and that a second approver is needed, never a reviewer', async () => {
    const text = textOf(await render())
    expect(text).toContain('Set up by Priya Shah (DripFunnel)')
    expect(text).toContain('Needs a second approver: anyone at DripFunnel but Priya Shah.')
    expect(text.toLowerCase()).not.toContain('reviewer')
  })

  it('counts the go-live checks and shows each one', async () => {
    const text = textOf(await render())
    expect(text).toContain('4 of 5 checks pass')
    for (const check of Object.values(messages.partners.checks)) expect(text).toContain(check)
    expect(text).toContain(words.check.fail)
  })

  it('reviews on the partner detail, the one place Approve is', async () => {
    const html = await render()
    expect(html).toContain('href="/partners/kl"')
    expect(textOf(html)).not.toContain(messages.partner.actions.approve)
  })

  it('says it is good news when nothing is waiting', async () => {
    expect(textOf(await render({ forced: 'empty' }))).toContain(words.empty.title)
  })

  it('shows a role without the menu the no-access view, pointing at Partners', async () => {
    const html = await render({ page: null })
    expect(textOf(html)).toContain(words.denied.title)
    expect(html).toContain('href="/partners?status=awaiting"')
  })
})
