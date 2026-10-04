import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Store, StorePage, StoreRow } from '../../api/stores'
import { createStoresServer, sampleStores } from '../../api/storesSample'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { NeedsLaptop } from '../common/NeedsLaptop'
import { phoneView } from '../common/phoneView'
import type { StaffRole } from '../shell/staffRoles'
import { FindStore, FindStoreView, firstFound, nextGo, searchAfterTyping, typedFrom, type FindResult } from './FindStore'
import { unlessPhone, widened } from '../common/usePhone'
import { phoneAction, PhoneStore } from './PhoneStore'
import { confirmOpening } from './StoreDetailScreen'
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

const render = async (node: ReactNode, at = '/') => {
  const rootRoute = createRootRoute({ component: () => node })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: [at] }) })
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
    const html = await find({ kind: 'found', rows, more: false })
    expect(textOf(html)).toContain(words.find.title)
    expect(html).toContain('role="search"')
    expect(html).toMatch(new RegExp(`<label for="[^"]+"[^>]*>${words.find.label}</label>`))
    expect([...html.matchAll(/href="\/stores\/(s\d+)"/g)].map((match) => match[1])).toEqual(rows.map((row) => row.id))
    expect(html).not.toContain('df-card')
  })

  it('says when nothing matches, while searching, and when the search failed (?state=nomatch, searching, failed)', async () => {
    expect(textOf(await find({ kind: 'found', rows: [], more: false }, 'zz'))).toContain(words.find.none)
    expect(textOf(await find({ kind: 'searching' }, 'me'))).toContain(words.find.searching)
    const failed = await find({ kind: 'failed' }, 'me')
    expect(textOf(failed)).toContain(words.find.failed)
    expect(buttons(failed)).toEqual([words.find.retry])
  })
})

describe('Find a store’s search', () => {
  afterEach(() => void vi.useRealTimers())
  const pageOf = (rows: readonly StoreRow[], more = false): StorePage => ({ items: [...rows], pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: more }, partners: [] })
  const rows = () => sample.list({}, {}, 25).items

  it('waits 250 ms after typing stops, then searches once and says whether more match', async () => {
    vi.useFakeTimers()
    const search = vi.fn(async () => pageOf(rows(), true))
    const results: FindResult[] = []
    searchAfterTyping('mer', search, (result) => results.push(result))
    await vi.advanceTimersByTimeAsync(249)
    expect(search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(search).toHaveBeenCalledWith('mer')
    expect(results).toEqual([{ kind: 'found', rows: rows(), more: true }])
  })

  it('drops a search typed over before it was sent, and an answer that arrives after newer typing', async () => {
    vi.useFakeTimers()
    const search = vi.fn(async () => pageOf(rows()))
    const results: FindResult[] = []
    searchAfterTyping('m', search, (result) => results.push(result))()
    await vi.advanceTimersByTimeAsync(300)
    expect(search).not.toHaveBeenCalled()
    let answer: (page: StorePage) => void = () => undefined
    const cancel = searchAfterTyping('me', () => new Promise((resolve) => (answer = resolve)), (result) => results.push(result))
    await vi.advanceTimersByTimeAsync(250)
    cancel()
    answer(pageOf(rows()))
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toEqual([])
  })

  it('says the search failed when the API does', async () => {
    vi.useFakeTimers()
    const results: FindResult[] = []
    searchAfterTyping('me', () => Promise.reject(new Error('down')), (result) => results.push(result))
    await vi.advanceTimersByTimeAsync(250)
    expect(results).toEqual([{ kind: 'failed' }])
  })

  it('opens with ?q= typed, and Enter opens the first store found', async () => {
    expect(typedFrom({ q: 'meridian' })).toBe('meridian')
    expect(typedFrom({ q: 3 })).toBe('')
    expect(await render(<FindStore />, '/?q=meridian')).toContain('value="meridian"')
    expect(firstFound({ kind: 'found', rows: rows(), more: false })?.id).toBe(rows()[0]?.id)
    expect(firstFound({ kind: 'found', rows: [], more: false })).toBeUndefined()
    expect(firstFound({ kind: 'searching' })).toBeUndefined()
  })

  it('holds ?q= to every search’s length', () => {
    expect(typedFrom({ q: `  ${'x'.repeat(5000)}` })).toHaveLength(100)
  })

  it('opens the first store on Go, waits for a search on its way, and opens nothing without a match', () => {
    const found: FindResult = { kind: 'found', rows: rows(), more: false }
    const first = rows()[0]
    expect(nextGo(false, { kind: 'go', result: found })).toEqual({ waiting: false, open: first })
    expect(nextGo(false, { kind: 'go', result: { kind: 'found', rows: [], more: false } })).toEqual({ waiting: false, open: null })
    expect(nextGo(false, { kind: 'go', result: { kind: 'failed' } })).toEqual({ waiting: false, open: null })
    const pressed = nextGo(false, { kind: 'go', result: { kind: 'searching' } })
    expect(pressed).toEqual({ waiting: true, open: null })
    expect(nextGo(pressed.waiting, { kind: 'answered', result: { kind: 'searching' } })).toEqual({ waiting: true, open: null })
    expect(nextGo(pressed.waiting, { kind: 'answered', result: found })).toEqual({ waiting: false, open: first })
    expect(nextGo(pressed.waiting, { kind: 'answered', result: { kind: 'found', rows: [], more: false } })).toEqual({ waiting: false, open: null })
    // Typing again cancels the wait, and a later answer opens nothing.
    const typed = nextGo(pressed.waiting, { kind: 'typed' })
    expect(typed).toEqual({ waiting: false, open: null })
    expect(nextGo(typed.waiting, { kind: 'answered', result: found })).toEqual({ waiting: false, open: null })
  })

  it('tells the person to type more when the API has more stores than one page', async () => {
    expect(textOf(await find({ kind: 'found', rows: rows(), more: true }, 'a'))).toContain(words.find.more)
    expect(textOf(await find({ kind: 'found', rows: rows(), more: false }, 'a'))).not.toContain(words.find.more)
  })
})

describe('the pages a phone replaces', () => {
  afterEach(() => void vi.unstubAllGlobals())
  const atWidth = (phone: boolean) => vi.stubGlobal('window', { matchMedia: () => ({ matches: phone }) })

  it('load nothing on a phone, load on a laptop, and load once the screen widens', async () => {
    const load = vi.fn(async () => 'page')
    atWidth(true)
    expect(unlessPhone(load)).toBeNull()
    expect(load).not.toHaveBeenCalled()
    atWidth(false)
    expect(await unlessPhone(load)).toBe('page')
    expect(widened(true, false)).toBe(true)
    expect(widened(false, false)).toBe(false)
    expect(widened(false, true)).toBe(false)
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

  it('opens ?state=confirm on the phone’s one action, and on the first allowed one on a laptop', () => {
    const store = storeOf('s1')
    expect(confirmOpening(phoneStore(store, 'active'), true)).toEqual({ kind: 'store', action: 'suspend' })
    expect(confirmOpening(phoneStore(store, 'suspended'), true)).toEqual({ kind: 'store', action: 'restore' })
    expect(confirmOpening(phoneStore(store, 'cancelled'), true)).toBeNull()
    expect(confirmOpening(store, false)).not.toBeNull()
    // A refused action opens no dialog on a phone either; the short view shows it disabled.
    expect(confirmOpening(phoneStore(storeOf('s1', 'staff-support'), 'active'), true)).toBeNull()
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
