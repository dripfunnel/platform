import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ActivityEntry, ActivityExport as ExportJob, ActivityFilter } from '../../api/activity'
import { actionCodes } from '../../api/activityActions'
import { createActivityServer, generateActivity } from '../../api/activitySample'
import { messages } from '../../messages'
import { textOf } from '@dripfunnel/shared/testing'
import { ActivityRow } from '../common/ActivityRow'
import { staffRoles, type StaffRole } from '../shell/staffRoles'
import { ActivityExport } from './ActivityExport'
import { ActivityLog, type ActivityLogProps } from './ActivityLog'
import { PersonFinder } from './PersonFinder'

const words = messages.activity
const now = Date.parse('2026-09-30T12:00:00Z')
const seed = generateActivity(now)
const server = createActivityServer(seed, { now: () => now })
const noop = () => undefined

const renderNode = async (node: ReactNode) => {
  const rootRoute = createRootRoute({ component: () => <>{node}</> })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/activity'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const renderLog = (props: Partial<ActivityLogProps> = {}, filter: ActivityFilter = {}, caller: StaffRole = 'staff-super-admin') =>
  renderNode(
    <ActivityLog
      page={server.list(filter, {}, 50, caller)}
      person={null}
      filter={filter}
      forced={null}
      exportJob={null}
      onFilterChange={noop}
      onChoosePerson={noop}
      onExport={noop}
      onReload={noop}
      {...props}
    />,
  )

const curated = (action: string, accessKind?: string): ActivityEntry => {
  const found = seed.find((entry) => entry.action === action && (!accessKind || entry.access?.kind === accessKind))
  if (!found) throw new Error(`No sample ${action}`)
  return found
}

const openRow = (entry: ActivityEntry) => renderNode(<ActivityRow entry={entry} open onToggle={noop} />)

describe('Activity log', () => {
  it('lists entries in plain words, newest first, without a total or any raw code', async () => {
    const html = await renderLog()
    const text = textOf(html)
    expect(text).toContain(words.newestFirst)
    expect(text).toContain(words.readOnlyNote)
    expect(html.match(/class="df-activity-row/g)).toHaveLength(50)
    for (const code of actionCodes) expect(text).not.toContain(code)
    expect(text).not.toMatch(/\b(of|total)\s+[\d,]+/i)
  })

  it('offers no way to edit or delete an entry', async () => {
    const text = textOf(await renderLog())
    expect(text).not.toMatch(/\b(Edit|Delete|Remove entry)\b/)
  })

  it('shows the session filters as chips that can be removed', async () => {
    const text = textOf(await renderLog({}, { imp: 'imp-7Q2' }))
    expect(text).toContain('Impersonation imp-7Q2')
    expect(text).toContain('Neha Rao as Priya Mehta')
  })

  it("shows a customer's scope, opened from their tab, as a removable chip of their own events", async () => {
    const html = await renderLog({}, { customer: 'c1' })
    expect(textOf(html)).toContain('Customer c1')
    expect(html).toContain('aria-label="Remove filter Customer c1"')
    expect(html.match(/class="df-activity-row/g)?.length).toBeGreaterThan(0)
  })

  it('says when nothing matches, with a way back', async () => {
    const text = textOf(await renderLog({}, { action: 'billing.payment_failed', partner: 'kl', date: 'today' }))
    expect(text).toContain(words.noMatch.title)
    expect(text).toContain(words.filters.clear)
  })

  it('renders the loading, error and empty states', async () => {
    expect(await renderLog({ forced: 'loading' })).toContain('df-skeleton')
    expect(textOf(await renderLog({ forced: 'error' }))).toContain(words.error.title)
    expect(textOf(await renderLog({ forced: 'empty' }))).toContain(words.empty.title)
  })
})

describe('an expanded entry', () => {
  it('links the impersonation session to its page and to all its entries', async () => {
    const html = await openRow(curated('product.updated', 'impersonation'))
    expect(html).toMatch(/<a[^>]*href="\/impersonate\/sessions\/imp-7Q2"[^>]*>Session imp-7Q2<\/a>/)
    expect(html).toContain('href="/activity?imp=imp-7Q2"')
    expect(textOf(html)).toContain(`${words.facts.agent}Neha Rao`)
  })

  it('links a setup session to its page and to all its entries', async () => {
    const html = await openRow(curated('plan.created', 'setupSession'))
    expect(html).toContain('href="/impersonate/sessions/su-4K9"')
    expect(html).toContain('href="/activity?su=su-4K9"')
  })

  it('shows the full IP and user agent on a sign-in, and the request id', async () => {
    const signIn = curated('person.signed_in')
    const text = textOf(await openRow(signIn))
    expect(signIn.ip).not.toBeNull()
    expect(text).toContain(signIn.ip ?? '')
    expect(text).toContain(signIn.userAgent ?? '')
    expect(text).toContain(signIn.requestId)
  })

  it('shows a hidden change as changed, never its value', async () => {
    const key = curated('api_key.created')
    expect(textOf(await openRow(key))).toContain('Secret: changed')
  })

  it('has a toggle that says what it opens', async () => {
    const html = await renderNode(<ActivityRow entry={curated('store.suspended')} open={false} onToggle={noop} />)
    expect(html).toMatch(/aria-expanded="false"/)
    expect(html).toMatch(/aria-controls="[^"]+"/)
    expect(html).toContain('aria-label="Details of the entry at')
  })
})

describe('export', () => {
  const exporters: readonly StaffRole[] = ['staff-super-admin', 'staff-engineer']

  it.each(staffRoles)('is offered to a Super admin or the Engineer on call, and disabled with the reason for %s', async (role) => {
    const html = await renderLog({}, {}, role)
    if (exporters.includes(role)) {
      expect(textOf(html)).not.toContain(words.export.refusal)
      expect(html).toMatch(/<button[^>]*>Export CSV<\/button>/)
    } else {
      expect(textOf(html)).toContain(words.export.refusal)
      expect(html).not.toMatch(/<button(?![^>]*disabled)[^>]*>Export CSV/)
    }
  })

  const job = (state: ExportJob['state'], more: Partial<ExportJob> = {}): ExportJob => ({ id: 'x1', state, entries: null, url: null, expiresAt: null, ...more })
  const renderExport = (exportJob: ExportJob) => renderNode(<ActivityExport permission={{ allowed: true }} job={exportJob} onExport={noop} />)

  it('says it is recorded, and cannot be started twice while preparing', async () => {
    const html = await renderExport(job('preparing'))
    expect(textOf(html)).toContain(words.export.recorded)
    expect(textOf(html)).toContain(words.export.preparing)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Export CSV/)
  })

  it('offers the download and when its link expires', async () => {
    const html = await renderExport(job('ready', { entries: 1204, url: 'blob:activity', expiresAt: '2026-09-30T13:00:00Z' }))
    expect(textOf(html)).toContain('Your export of 1,204 entries is ready.')
    expect(html).toContain('href="blob:activity"')
    expect(textOf(html)).toContain('The link expires at')
  })

  it('has an expired state, a too-large state and a failed state', async () => {
    expect(textOf(await renderExport(job('expired')))).toContain(words.export.expired)
    expect(textOf(await renderExport(job('tooLarge')))).toContain('More than 100,000 entries match.')
    expect(textOf(await renderExport(job('failed')))).toContain(words.export.failed)
  })
})

describe('PersonFinder', () => {
  it('is an ARIA combobox tied to its listbox and announces its results', async () => {
    const html = await renderNode(<PersonFinder onChoose={noop} />)
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-autocomplete="list"')
    expect(html).toContain('aria-expanded="false"')
    const controls = /aria-controls="([^"]+)"/.exec(html)?.[1]
    expect(controls).toBeDefined()
    expect(html).toContain(`id="${controls}" role="listbox"`)
    expect(html).toContain('role="status"')
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Find a person<\/label>/)
  })
})
