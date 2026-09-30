import { describe, expect, it } from 'vitest'
import { createStoresServer, sampleStores } from './storesSample'

const now = () => '2026-09-30T00:00:00Z'
const server = () => createStoresServer(sampleStores, now)
const ids = (page: { items: readonly { id: string }[] }) => page.items.map((store) => store.id)

describe('stores sample server', () => {
  it('lists newest first and pages by cursor both ways', () => {
    const stores = server()
    const first = stores.list({}, {}, 4)
    expect(ids(first)).toEqual(['s13', 's14', 's5', 's12'])
    expect(first.pageInfo).toMatchObject({ hasPreviousPage: false, hasNextPage: true })
    const second = stores.list({}, { after: first.pageInfo.endCursor ?? '' }, 4)
    expect(ids(second)).toEqual(['s9', 's2', 's6', 's11'])
    expect(second.pageInfo.hasPreviousPage).toBe(true)
    const back = stores.list({}, { before: second.pageInfo.startCursor ?? '' }, 4)
    expect(ids(back)).toEqual(ids(first))
  })

  it('filters by setup, created window, partner and search, as the Dashboard links need', () => {
    const stores = server()
    expect(ids(stores.list({ setup: 'stuck' }, {}, 25))).toEqual(['s5'])
    expect(ids(stores.list({ setup: 'running' }, {}, 25))).toEqual(['s14'])
    expect(ids(stores.list({ created: '7d' }, {}, 25))).toEqual(['s13', 's14', 's5', 's12', 's9'])
    expect(ids(stores.list({ created: '30d' }, {}, 25))).toContain('s2')
    expect(ids(stores.list({ partner: 'lt' }, {}, 25))).toEqual(['s8'])
    expect(ids(stores.list({ q: 'KIKOKIDS.AE' }, {}, 25))).toEqual(['s3'])
    expect(ids(stores.list({ storefront: 'own' }, {}, 25))).toEqual(['s7'])
  })

  it('offers Retry only while setup failed or is stuck, and Undo only for a failed signup', () => {
    const stores = server()
    expect(stores.get('s13', 'staff-super-admin')?.actions).toMatchObject({ retry: { allowed: true }, undo: { allowed: true } })
    expect(stores.get('s5', 'staff-super-admin')?.actions.undo).toBeUndefined()
    expect(stores.get('s5', 'staff-support')?.actions.retry).toEqual({ allowed: true })
    expect(stores.get('s13', 'staff-support')?.actions.undo).toEqual({ allowed: false, reason: 'CLEANERS_ONLY' })
    expect(stores.get('s1', 'staff-super-admin')?.actions.retry).toBeUndefined()
  })

  it('lets the Engineer on call suspend as an emergency, and only a Super admin restore', () => {
    const stores = server()
    expect(stores.get('s1', 'staff-engineer')?.actions.suspend).toEqual({ allowed: true, emergency: true })
    expect(stores.get('s1', 'staff-support')?.actions.suspend).toEqual({ allowed: false, reason: 'SUSPENDERS_ONLY' })
    expect(stores.get('s4', 'staff-engineer')?.actions.restore).toEqual({ allowed: false, reason: 'SUPER_ADMIN_ONLY' })
    expect(stores.get('s4', 'staff-super-admin')?.actions.restore).toEqual({ allowed: true })
  })

  it('lets four roles add notes, and nobody read-only', () => {
    const stores = server()
    for (const role of ['staff-super-admin', 'staff-partner-manager', 'staff-support', 'staff-engineer'] as const) {
      expect(stores.get('s1', role)?.actions.addNote).toEqual({ allowed: true })
    }
    expect(stores.get('s1', 'staff-read-only')?.actions.addNote).toEqual({ allowed: false, reason: 'NOTERS_ONLY' })
  })

  it('restores a suspended past-due store to past due, not to active', () => {
    const stores = server()
    stores.run('s3', 'suspend', 'Fraud check', null)
    expect(stores.get('s3', 'staff-super-admin')?.state).toMatchObject({ kind: 'suspended', reason: 'Fraud check', previous: 'pastdue' })
    stores.run('s3', 'restore', 'Cleared', null)
    expect(stores.get('s3', 'staff-super-admin')?.state).toEqual({ kind: 'pastdue', daysPastDue: 9 })
  })

  it('extends a trial, adds a note, and removes a cleaned-up signup', () => {
    const stores = server()
    stores.run('s2', 'extendTrial', 'Asked nicely', '2026-10-15')
    expect(stores.get('s2', 'staff-super-admin')?.state).toMatchObject({ kind: 'trial', trialEndsAt: '2026-10-15T00:00:00Z', daysLeft: 15 })
    stores.run('s2', 'addNote', null, '  Called the owner.  ')
    expect(stores.get('s2', 'staff-super-admin')?.notes[0]?.text).toBe('Called the owner.')
    stores.run('s13', 'undo', 'Retries failed', null)
    expect(stores.get('s13', 'staff-super-admin')).toBeNull()
    expect(ids(stores.list({}, {}, 25))).not.toContain('s13')
  })

  it('keeps each server separate, so one test never sees another test changes', () => {
    server().run('s13', 'undo', 'x', null)
    expect(server().get('s13', 'staff-super-admin')).not.toBeNull()
  })
})
