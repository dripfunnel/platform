import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { messages } from '../../messages'
import { ActivityLog, personOptionOf, type ActivityLogProps } from './ActivityLog'
import { ActivityRow } from './ActivityRow'
import { entryText, kindOf, whoOf } from './activityText'
import { entries, stores } from './activityTestData'

const words = messages.activity
const noop = () => undefined
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/activity'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const entry = (id: string) => {
  const found = entries.find((e) => e.id === id)
  if (!found) throw new Error(`no test entry ${id}`)
  return found
}

const log = (props: Partial<ActivityLogProps> = {}) =>
  render(
    <ActivityLog
      entries={entries}
      more={false}
      moreState="idle"
      filter={{}}
      person={null}
      stores={stores}
      forced={null}
      exportJob={null}
      canExport
      findPeople={() => Promise.resolve([])}
      onChoosePerson={noop}
      onFilter={noop}
      onMore={noop}
      onExport={noop}
      onRetry={noop}
      {...props}
    />,
  )

describe('an entry in plain words', () => {
  it('names who did what, with the reason, never only the code', () => {
    expect(entryText(entry('e1'))).toBe('Maya Chen extended Lumen Candle Co.’s trial: customer request')
    expect(entryText(entry('e4'))).toBe('Jess Moreno suspended Lumen Candle Co. (refused)')
    expect(entryText(entry('e5'))).toBe('DripFunnel: partner.domain_checked')
  })

  it('names support acting as a team member, and tags setup and support sessions', () => {
    expect(whoOf(entry('e3'))).toBe('Neha Rao as Diego Alvarez')
    expect(entryText({ ...entry('e3'), target: { type: 'partner_user', id: 'pu9', label: 'Sam Lee <sam@northstar.example>' } })).toBe('Neha Rao as Diego Alvarez invited Sam Lee to the team')
    expect(kindOf(entry('e3'))).toBe(words.tags.impersonation)
    expect(kindOf(entry('e2'))).toBe(words.tags.setup_session)
    expect(kindOf(entry('e1'))).toBe(words.actors.partner_user)
  })

  it('opens to When, Who with its kind, Store, Before, After and Reason', async () => {
    const closed = textOf(await render(<ActivityRow entry={entry('e1')} storeName="Lumen Candle Co." open={false} onToggle={noop} />))
    expect(closed).not.toContain(words.facts.reason)
    const open = textOf(await render(<ActivityRow entry={entry('e1')} storeName="Lumen Candle Co." open onToggle={noop} />))
    for (const label of [words.facts.when, words.facts.who, words.facts.store, words.facts.reason]) expect(open.toUpperCase()).toContain(label.toUpperCase())
    expect(open).toContain('Maya Chen (Your team)')
    expect(open).toContain('2026-10-01')
    expect(open).toContain('2026-10-08')
    const setup = await render(<ActivityRow entry={entry('e2')} storeName={null} open={false} onToggle={noop} />)
    expect(textOf(setup)).toContain(words.tags.setup_session)
  })
})

describe('the Activity log', () => {
  it('lists the entries newest first with a count, and says when there are more', async () => {
    expect(textOf(await log())).toContain('5 entries · newest first')
    const more = textOf(await log({ more: true }))
    expect(more).toContain('5+ entries · newest first')
    expect(more).toContain(words.showMore)
  })

  it('shows each applied filter as a removable chip, with Clear all', async () => {
    const text = textOf(await log({ filter: { who: 'setup', result: 'denied', storeId: 's1', date: '7d', action: 'store.suspended' } }))
    for (const chip of ['Who: DripFunnel setup', 'Result: Denied', 'Store: Lumen Candle Co.', 'Date: Last 7 days', 'Action: Store suspended']) expect(text).toContain(chip)
    expect(text).toContain(words.filters.clear)
  })

  it('says nothing matches when filtered, and starts a new partner empty', async () => {
    expect(textOf(await log({ entries: [], filter: { result: 'failed' } }))).toContain(words.none)
    expect(textOf(await log({ entries: [] }))).toContain(words.empty.title)
    expect(textOf(await log({ forced: 'empty' }))).toContain(words.empty.title)
  })

  it('follows a chosen person with Show everyone, by name when it is known', async () => {
    const html = await log({ person: { ref: 'team:pu1', name: 'Maya Chen' } })
    expect(textOf(html)).toContain('Maya Chen’s timeline')
    expect(textOf(html)).toContain(words.person.everyone)
    expect(html).toContain('href="/activity"')
    expect(textOf(await log({ person: { ref: 'team:pu1', name: null } }))).toContain(words.person.someone)
  })

  it('offers Export CSV to Owners and Admins, refused with the reason for the rest, and shows the job', async () => {
    expect(textOf(await log({ canExport: false }))).toContain(words.export.refused)
    const ready = textOf(await log({ exportJob: { id: 'x1', state: 'ready', entries: 120, url: 'blob:x', expiresAt: null, truncated: false } }))
    expect(ready).toContain('Your export of 120 entries is ready.')
  })

  it('loads and fails in its own words', async () => {
    expect(await log({ forced: 'loading' })).toContain('df-skeleton')
    expect(textOf(await log({ forced: 'error' }))).toContain(words.error.title)
  })
})

describe('the person search', () => {
  it('words a team member by role and an Owner by their store', () => {
    expect(personOptionOf({ ref: 'team:pu1', name: 'Maya Chen', kind: 'team', detail: 'partner-admin' })).toEqual({ id: 'team:pu1', name: 'Maya Chen', line: 'Your team · Admin', kind: '' })
    expect(personOptionOf({ ref: 'owner:u1', name: 'Rohan Mehta', kind: 'owner', detail: 'Mehta Textiles' }).line).toBe('Owner of Mehta Textiles')
  })
})
