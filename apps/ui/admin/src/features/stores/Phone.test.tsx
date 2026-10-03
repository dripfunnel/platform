import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Store } from '../../api/stores'
import { createStoresServer, sampleStores } from '../../api/storesSample'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { NeedsLaptop } from '../common/NeedsLaptop'
import { phoneView } from '../common/phoneView'
import type { StaffRole } from '../shell/staffRoles'
import { FindStoreView, type FindResult } from './FindStore'
import { phoneAction, PhoneStore } from './PhoneStore'
import { storeDialog } from './storeDialog'
import { phoneStore } from './storeHarness'

const words = messages.phone
const sample = createStoresServer(sampleStores, () => '2026-09-30T00:00:00Z')
const noop = () => undefined

const storeOf = (id: string, role: StaffRole = 'staff-super-admin'): Store => {
  const store = sample.get(id, role)
  if (!store) throw new Error(`No sample store ${id}`)
  return store
}

const render = async (node: ReactNode) => {
  const rootRoute = createRootRoute({ component: () => node })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const find = (result: FindResult, typed = '') => render(<FindStoreView typed={typed} result={result} onType={noop} onRetry={noop} onSubmit={noop} />)
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => textOf(match[1] ?? ''))

describe('phoneView', () => {
  it('finds a store from the Dashboard and the Stores list, shows a store, and sends every other page to a laptop', () => {
    expect(phoneView('/_app/dashboard')).toBe('find')
    expect(phoneView('/_app/stores')).toBe('find')
    expect(phoneView('/_app/stores_/$storeId')).toBe('store')
    for (const other of ['/_app/partners', '/_app/partners_/$partnerId', '/_app/staff', '/_app/activity', '/_app/provisioning', undefined]) expect(phoneView(other)).toBe('laptop')
  })
})

describe('Find a store', () => {
  it('is a heading and a labelled search box, then the stores found as links to each', async () => {
    const rows = sample.list({}, {}, 25).items
    const html = await find({ kind: 'found', rows })
    expect(textOf(html)).toContain(words.find.title)
    expect(html).toContain('role="search"')
    expect(html).toMatch(new RegExp(`<label for="[^"]+"[^>]*>${words.find.label}</label>`))
    expect([...html.matchAll(/href="\/stores\/(s\d+)"/g)].map((match) => match[1])).toEqual(rows.map((row) => row.id))
    expect(html).not.toContain('df-card')
  })

  it('says when nothing matches, while searching, and when the search failed (?state=nomatch, searching, failed)', async () => {
    expect(textOf(await find({ kind: 'found', rows: [] }, 'zz'))).toContain(words.find.none)
    expect(textOf(await find({ kind: 'searching' }, 'me'))).toContain(words.find.searching)
    const failed = await find({ kind: 'failed' }, 'me')
    expect(textOf(failed)).toContain(words.find.failed)
    expect(buttons(failed)).toEqual([words.find.retry])
  })
})

describe('the short store view', () => {
  it('names the store and its partner, then exactly the five rows, in order', async () => {
    const store = storeOf('s1')
    const html = await render(<PhoneStore store={store} onAction={noop} />)
    expect(textOf(html)).toContain(store.name)
    expect(textOf(html)).toContain(store.partner.name)
    expect([...html.matchAll(/<dt>([^<]*)<\/dt>/g)].map((match) => match[1])).toEqual(Object.values(words.store.rows))
    expect(textOf(html)).toContain(`‹ ${words.store.back}`)
  })

  it('reads Setup as Done, or the state and the step it stopped at, in the Provisioning tab’s words', async () => {
    const html = textOf(await render(<PhoneStore store={storeOf('s13')} onAction={noop} />))
    expect(html).toContain(`${messages.store.provisioning.stepStatus.failed} at ${messages.provisioning.steps.repo}`)
  })

  it('offers one action for the status: Suspend, Restore when suspended, none when cancelled', async () => {
    const store = storeOf('s1')
    expect(buttons(await render(<PhoneStore store={phoneStore(store, 'active')} onAction={noop} />))).toEqual([words.store.actions.suspend])
    expect(buttons(await render(<PhoneStore store={phoneStore(store, 'suspended')} onAction={noop} />))).toEqual([words.store.actions.restore])
    expect(buttons(await render(<PhoneStore store={phoneStore(store, 'cancelled')} onAction={noop} />))).toEqual([])
    expect(phoneAction(storeOf('s4'))).toBe('restore')
    expect(phoneAction(storeOf('s10'))).toBeNull()
  })

  it('shows a refused action disabled with the API’s reason', async () => {
    const html = await render(<PhoneStore store={storeOf('s1', 'staff-support')} onAction={noop} />)
    expect(html).toMatch(/<button[^>]*disabled=""/)
    expect(textOf(html)).toContain(messages.stores.verbs.suspend)
  })

  it('confirms through the same dialog as a laptop: a reason, and the on-call note for an Engineer on call', () => {
    const dialog = storeDialog('suspend', storeOf('s1', 'staff-engineer'))
    expect(dialog.reason).toBeDefined()
    expect(dialog.notes).toContain(messages.store.dialogs.suspend.emergency)
  })
})

describe('Needs a laptop', () => {
  it('says so and leads back to Find a store', async () => {
    const html = await render(<NeedsLaptop />)
    expect(textOf(html)).toContain(words.laptop.body)
    expect(html).toContain('href="/stores"')
  })
})
