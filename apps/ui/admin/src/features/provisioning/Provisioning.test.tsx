import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createProvisioningServer } from '../../api/provisioningSample'
import { createStoresServer, sampleStores } from '../../api/storesSample'
import { messages } from '../../messages'
import { textOf } from '@dripfunnel/shared/testing'
import type { StaffRole } from '../shell/staffRoles'
import { Provisioning, type ProvisioningProps } from './Provisioning'

const words = messages.provisioning
const noop = () => undefined
const pageFor = (role: StaffRole = 'staff-super-admin', filter: ProvisioningProps['filter'] = {}) =>
  createProvisioningServer(createStoresServer(sampleStores).signups, noop).list(filter, {}, 25, role)

const render = async (props: Partial<ProvisioningProps> = {}, path = '/provisioning') => {
  const rootRoute = createRootRoute({
    component: () => <Provisioning page={pageFor()} filter={{}} forced={null} onFilterChange={noop} onJob={noop} onReload={noop} {...props} />,
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('Provisioning', () => {
  it('shows each job with its own step total, state and plain-words error', async () => {
    const text = textOf(await render())
    expect(text).toContain('Peak Supply Co.')
    expect(text).toContain('4 of 8 · Repo')
    expect(text).toContain('3 of 3 · Hostnames')
    expect(text).toContain('7 of 8 · First build')
    expect(text).toContain(words.states.stuck)
    expect(text).toContain('GitHub didn’t respond while creating the storefront.')
  })

  it('has the partner, state and step filters and a search, with no Done step', async () => {
    const html = await render()
    expect(html.match(/<select/g)).toHaveLength(3)
    expect(html).toContain(words.filters.searchPlaceholder)
    expect(html).not.toContain(`value="done"`)
  })

  it('opens every step on the store’s own Provisioning tab', async () => {
    expect(await render()).toContain('href="/stores/s13?tab=provisioning"')
  })

  it('keeps the raw details behind a click', async () => {
    const closed = await render()
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).not.toContain('df-job-details')
  })

  it('holds both actions back while a job runs, each with its reason', async () => {
    const text = textOf(await render())
    expect(text).toContain(words.refusals.JOB_RUNNING.retry)
    expect(text).toContain(words.refusals.JOB_RUNNING.undo)
  })

  it('shows Support the Undo refusal beside a live Retry', async () => {
    expect(textOf(await render({ page: pageFor('staff-support') }))).toContain('Only a Super admin or the Engineer on call can undo a failed signup.')
  })

  it('keeps the sample pace and the filters on the next page', async () => {
    const page = createProvisioningServer(createStoresServer(sampleStores).signups, noop).list({ partner: 'df' }, {}, 1, 'staff-super-admin')
    const html = await render({ page, filter: { partner: 'df' } }, '/provisioning?partner=df&pace=fast')
    const next = [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&')).find((href) => href.includes('after=')) ?? ''
    expect(next.startsWith('/provisioning?')).toBe(true)
    expect(next).toContain('partner=df')
    expect(next).toContain('pace=fast')
  })

  it('says it is good news when nothing is running or failing', async () => {
    expect(textOf(await render({ forced: 'empty' }))).toContain(words.empty.title)
  })

  it('says when nothing matches, and offers to clear the filters', async () => {
    const text = textOf(await render({ page: pageFor('staff-super-admin', { q: 'nothing' }), filter: { q: 'nothing' } }))
    expect(text).toContain(words.noMatch.title)
    expect(text).toContain(words.filters.clear)
  })

  it('shows a role without the menu the no-access view', async () => {
    const text = textOf(await render({ page: pageFor('staff-finance') }))
    expect(text).toContain(words.denied.title)
    expect(text).not.toContain('Peak Supply Co.')
  })
})
