import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createSampleServer, samplePartners } from '../../api/partnersSample'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { Partners, type PartnersProps } from './Partners'

const words = messages.partners
const sample = createSampleServer(samplePartners)
const noop = () => undefined

const render = async (props: Partial<PartnersProps> = {}) => {
  const rootRoute = createRootRoute({
    component: () => (
      <Partners
        page={sample.list({}, {}, 25, 'staff-super-admin')}
        filter={{}}
        forced={null}
        readOnly={false}
        onFilterChange={noop}
        onReload={noop}
        {...props}
      />
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/partners'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'))

describe('Partners list', () => {
  it('has exactly the columns FIRST-RELEASE.md §4.1 names, in order', async () => {
    const headers = [...(await render()).matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((match) => match[1])
    expect(headers).toEqual(Object.values(words.columns))
  })

  it('badges the house partner, and only the house partner', async () => {
    const html = await render()
    expect(html.match(/df-house-badge/g)).toHaveLength(1)
    expect(textOf(html)).toContain(`DripFunnel${words.houseBadge}`)
  })

  it('links each partner to its page and its store count to Stores, filtered', async () => {
    const links = hrefs(await render())
    expect(links).toContain('/partners/kl')
    expect(links).toContain('/stores?partner=bz')
  })

  it('says how many there are, newest first, and shows each setup and host status', async () => {
    const text = textOf(await render())
    expect(text).toContain('7 partners · newest first')
    expect(text).toContain('6 of 8')
    expect(text).toContain(words.setupComplete)
    expect(text).toContain(words.hostStatus.waiting)
    expect(text).toContain(words.invitation.held)
  })

  it('pages with Previous and Next, carrying the filters, and no page numbers', async () => {
    const html = await render({ page: sample.list({ setup: 'incomplete' }, {}, 2, 'staff-super-admin'), filter: { setup: 'incomplete' } })
    expect(hrefs(html)).toContain('/partners?setup=incomplete&after=nl')
    expect(html).toMatch(/<button type="button" class="df-button" disabled="">Previous<\/button>/)
  })

  it('shows Create partner disabled, with the reason as text, to a role that cannot create one', async () => {
    const html = await render({ page: sample.list({}, {}, 25, 'staff-support') })
    expect(html).toMatch(/<button type="button" class="df-button" disabled=""[^>]*>Create partner<\/button>/)
    expect(textOf(html)).toContain('Only a Super admin or Partner manager can create partners.')
  })

  it('links Create partner to its own screen for a role that can', async () => {
    expect(hrefs(await render())).toContain('/partners/new')
  })

  it('reads like a first run when the platform has no partner', async () => {
    const text = textOf(await render({ forced: 'empty' }))
    expect(text).toContain(words.empty.title)
    expect(text).toContain(words.create)
  })

  it('tells a filtered view with no match apart from an empty platform', async () => {
    const text = textOf(await render({ page: sample.list({ q: 'nothing like this' }, {}, 25, 'staff-super-admin'), filter: { q: 'nothing like this' } }))
    expect(text).toContain(words.noMatch.title)
    expect(text).not.toContain(words.empty.title)
  })

  it('loads as skeletons, with no numbers', async () => {
    const html = await render({ forced: 'loading' })
    expect(html).toContain('df-skeleton')
    expect(textOf(html).replace(words.sub, '')).not.toMatch(/\d/)
  })

  it('explains an error in plain words, with a retry', async () => {
    const html = await render({ forced: 'error' })
    expect(html).toContain('role="alert"')
    expect(textOf(html)).toContain(words.error.retry)
  })

  it('says read-only access in the info palette, never the warning one', async () => {
    const html = await render({ readOnly: true })
    expect(html).toContain('df-state--info')
    expect(html).not.toContain('df-state--warning')
  })
})
