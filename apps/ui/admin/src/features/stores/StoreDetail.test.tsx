import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { storeNoteMaxLength, type Store } from '../../api/stores'
import { createStoresServer, sampleStores } from '../../api/storesSample'
import type { StaffRole } from '../shell/staffRoles'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { StoreDetail, type StoreDetailProps } from './StoreDetail'
import { storeDialog } from './storeDialog'
import { storeTabs } from './StoreTabs'

const words = messages.store
const sample = createStoresServer(sampleStores, () => '2026-09-30T00:00:00Z')
const noop = () => undefined
const resolved = () => Promise.resolve()
const saved = () => Promise.resolve(true)

const storeOf = (id: string, role: StaffRole = 'staff-super-admin'): Store => {
  const store = sample.get(id, role)
  if (!store) throw new Error(`No sample store ${id}`)
  return store
}

const render = async (props: Partial<StoreDetailProps> = {}) => {
  const rootRoute = createRootRoute({
    component: () => (
      <StoreDetail
        store={storeOf('s13')}
        tab="overview"
        forced={null}
        readOnly={false}
        onAction={noop}
        onJob={noop}
        onAddNote={saved}
        onRecheck={resolved}
        customers={{ filter: {}, page: {}, onFilterChange: noop }}
        onReload={noop}
        activity={null}
        {...props}
      />
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/stores/s13'] }) })
  await router.load()
  return textOf(renderToString(<RouterProvider router={router} />))
}

describe('Store detail', () => {
  it('has the tabs decided on #20, with the Customers tab #42 adds after Users', async () => {
    const text = await render()
    for (const label of Object.values(words.tabs)) expect(text).toContain(label)
    expect(storeTabs.indexOf('customers')).toBe(storeTabs.indexOf('users') + 1)
  })

  it('offers Retry in the header while setup failed, and Undo on the Provisioning tab', async () => {
    const text = await render({ tab: 'provisioning' })
    expect(text).toContain(words.retrySetup)
    expect(text).toContain('GitHub didn’t respond while creating the storefront.')
    expect(text).toContain('4 of 8 · Repo · 2 attempts')
    expect(text).toContain(words.provisioning.retry)
    expect(text).toContain(messages.provisioning.actions.undo)
  })

  it('counts only the three steps a store with its own frontend runs', async () => {
    const text = await render({ store: storeOf('s14'), tab: 'provisioning' })
    expect(text).toContain('3 of 3 · Hostnames')
    expect(text).not.toContain(messages.provisioning.steps.repo)
    expect(text).not.toContain(words.provisioning.undoTitle)
  })

  it('shows a refused action with its reason as text', async () => {
    const text = await render({ store: storeOf('s13', 'staff-support'), tab: 'provisioning' })
    expect(text).toContain('Only a Super admin or the Engineer on call can undo a failed signup.')
  })

  it('keeps Impersonate turned off with its reason, and Support read-only', async () => {
    expect(await render({ store: storeOf('s1'), tab: 'users' })).toContain(words.users.impersonateUnavailable)
    const support = await render({ store: storeOf('s7'), tab: 'support' })
    expect(support).toContain(words.support.off)
    expect(support).toContain(words.support.sub)
  })

  it(
    'renders every tab of every sample store',
    async () => {
      for (const { id } of sampleStores) {
        for (const tab of storeTabs) await expect(render({ store: storeOf(id), tab })).resolves.toContain(words.tabs.overview)
      }
    },
    15_000,
  )

  it('writes each history entry in the prototype words', async () => {
    const text = await render({ store: storeOf('s3') })
    expect(text).toContain('Past due after 3 failed payments')
    expect(text).toContain('Active on Growth UAE')
    expect(await render({ store: storeOf('s4') })).toContain('Suspended by Arjun Menon: chargeback')
  })

  it('caps the note field at the length the API accepts', async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <StoreDetail store={storeOf('s3')} tab="notes" forced={null} readOnly={false} onAction={noop} onJob={noop} onAddNote={saved} onRecheck={resolved}
          customers={{ filter: {}, page: {}, onFilterChange: noop }}
          onReload={noop}
          activity={null}
        />
      ),
    })
    const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/stores/s3'] }) })
    await router.load()
    expect(renderToString(<RouterProvider router={router} />)).toContain(`maxLength="${storeNoteMaxLength}"`)
  })

  it('says a missing store was maybe cleaned up', async () => {
    expect(await render({ store: null })).toContain(words.notFound.title)
  })
})

describe('store dialogs', () => {
  it('adds the emergency note only for the Engineer on call', () => {
    expect(storeDialog('suspend', storeOf('s1', 'staff-engineer')).notes).toContain(words.dialogs.suspend.emergency)
    expect(storeDialog('suspend', storeOf('s1')).notes).not.toContain(words.dialogs.suspend.emergency)
  })

  it('points the suspended owner at the partner support and asks for the store name', () => {
    const dialog = storeDialog('suspend', storeOf('s3'))
    expect(dialog.notes).toContain('The owner is told to contact Bazaar Cloud support.')
    expect(dialog.typeToConfirm?.expected).toBe('Kiko Kids')
  })

  it('restores to the status the store had before', () => {
    expect(storeDialog('restore', storeOf('s4')).consequence).toBe('Back to Active.')
  })

  it('defaults a trial extension to 14 days on and refuses a date on or before the current end', () => {
    const input = storeDialog('extendTrial', storeOf('s2')).input
    expect(input?.initial).toBe('2026-10-13')
    expect(input?.error('')).toBe(words.dialogs.extendTrial.pick)
    expect(input?.error('2026-09-29')).toBe('Pick a date after the current end, Sep 29, 2026.')
    expect(input?.error('2026-09-30')).toBeNull()
  })
})
