import { createPortalSessionFixture } from '@dripfunnel/shared/ui'
import { describe, expect, it } from 'vitest'
import type { StaffRole } from '../features/shell/staffRoles'
import { createImpersonationServer } from './impersonationSample'

const start = Date.parse('2026-10-01T09:00:00Z')

const setup = () => {
  let time = start
  const server = createImpersonationServer({ now: () => time, reauthDelayMs: 0 })
  const proof = async () => {
    const answer = await server.reauthenticate(null)
    if (!answer.ok) throw new Error('The sample sign-in refused.')
    return answer.proof
  }
  const impersonate = async (membershipId: string, caller: StaffRole = 'staff-super-admin') => {
    const target = server.target(membershipId, caller)
    if (!target) throw new Error(`No sample target ${membershipId}`)
    return server.startImpersonation(target.id, membershipId, 'Fixing their collection', null, await proof(), caller)
  }
  return { server, proof, impersonate, advance: (minutes: number) => (time += minutes * 60_000) }
}

const tokenOf = (handoff: string) => new URL(handoff).searchParams.get('token') ?? ''

describe('the staff-session sample, as the Admin API will answer', () => {
  it('lists partner and store users only, never staff or shoppers', () => {
    const { server } = setup()
    const page = server.targets({}, {}, null, 200, 'staff-support')
    expect(page?.items.length).toBeGreaterThan(0)
    for (const target of page?.items ?? []) expect(['partnerUser', 'storeUser', 'supplierUser']).toContain(target.kind)
    expect(page?.items.some((target) => target.email.endsWith('@dripfunnel.com'))).toBe(false)
  })

  it('pages the users with cursors both ways', () => {
    const { server } = setup()
    const first = server.targets({}, {}, null, 3, 'staff-super-admin')
    const after = first?.pageInfo.endCursor ?? ''
    const second = server.targets({}, { after }, null, 3, 'staff-super-admin')
    expect(second?.pageInfo.hasPreviousPage).toBe(true)
    const back = server.targets({}, { before: second?.pageInfo.startCursor ?? '' }, null, 3, 'staff-super-admin')
    expect(back?.items.map((target) => target.id)).toEqual(first?.items.map((target) => target.id))
  })

  it('answers no list to the roles that may not impersonate', () => {
    const { server } = setup()
    for (const role of ['staff-partner-manager', 'staff-finance', 'staff-engineer', 'staff-read-only'] as const) {
      expect(server.targets({}, {}, null, 25, role)).toBeNull()
      expect(server.sessions({}, {}, 25, role)).toBeNull()
    }
  })

  it('refuses an inactive user, naming why', async () => {
    const { server, impersonate } = setup()
    expect(server.target('s1-u4', 'staff-support')?.impersonate).toEqual({ allowed: false, reason: 'TARGET_NOT_ACTIVE' })
    expect(await impersonate('s1-u4')).toEqual({ ok: false, reason: 'TARGET_NOT_ACTIVE' })
  })

  it('keeps one open impersonation per staff member', async () => {
    const { impersonate } = setup()
    expect((await impersonate('s1-u1')).ok).toBe(true)
    expect(await impersonate('s1-u3')).toEqual({ ok: false, reason: 'IMPERSONATION_ALREADY_OPEN' })
  })

  it('asks for a reason and a fresh, single-use sign-in for both kinds', async () => {
    const { server, proof } = setup()
    const once = await proof()
    expect(server.startImpersonation('s1-u1', 's1-u1', ' ', null, once, 'staff-super-admin')).toEqual({ ok: false, reason: 'REASON_REQUIRED' })
    expect(server.startSetup('kl', 'Help with plans', null, 'made-up', 'staff-super-admin')).toEqual({ ok: false, reason: 'REAUTH_REQUIRED' })
    expect(server.startSetup('kl', 'Help with plans', null, once, 'staff-super-admin').ok).toBe(true)
    expect(server.startImpersonation('s1-u1', 's1-u1', 'Again', null, once, 'staff-super-admin')).toEqual({ ok: false, reason: 'REAUTH_REQUIRED' })
  })

  it('refuses Support a setup session, and a second open one to anyone', async () => {
    const { server, proof } = setup()
    expect(server.startSetup('kl', 'Help', null, await proof(), 'staff-support')).toEqual({ ok: false, reason: 'STAFF_ROLE_NOT_ALLOWED' })
    expect(server.startSetup('kl', 'Help', null, await proof(), 'staff-partner-manager').ok).toBe(true)
    expect(server.startSetup('ts', 'Help', null, await proof(), 'staff-partner-manager')).toEqual({ ok: false, reason: 'SETUP_SESSION_ALREADY_OPEN' })
  })

  it('extends an impersonation once, by whoever is acting, and never a setup session', () => {
    const { server } = setup()
    const id = 'imp-open1'
    expect(server.extend(id, 'staff-super-admin')).toEqual({ ok: false, reason: 'NOT_SESSION_OWNER' })
    expect(server.extend(id, 'staff-support')).toEqual({ ok: true })
    expect(server.extend(id, 'staff-support')).toEqual({ ok: false, reason: 'IMPERSONATION_ALREADY_EXTENDED' })
    const extended = server.session(id, 'staff-support')
    expect(extended.kind === 'found' && Date.parse(extended.session.expiresAt) - Date.parse(extended.session.startedAt)).toBe(60 * 60_000)
    expect(server.extend('su-open1', 'staff-super-admin')).toEqual({ ok: false, reason: 'SETUP_SESSION_NOT_EXTENDABLE' })
  })

  it('lets the starter or a Super admin end a session, and nobody else', () => {
    const { server } = setup()
    expect(server.end('su-open1', 'staff-partner-manager')).toEqual({ ok: false, reason: 'NOT_SESSION_OWNER' })
    expect(server.end('su-open1', 'staff-super-admin')).toEqual({ ok: true })
    expect(server.end('su-open1', 'staff-super-admin')).toEqual({ ok: false, reason: 'SESSION_ENDED' })
    expect(server.end('imp-open1', 'staff-support')).toEqual({ ok: true })
  })

  it('expires a session at its end, and then refuses to return to it', () => {
    const { server, advance } = setup()
    advance(30)
    const lookup = server.session('imp-open1', 'staff-support')
    expect(lookup.kind === 'found' && lookup.session.outcome).toBe('expired')
    expect(server.returnTo('imp-open1', 'staff-support')).toEqual({ ok: false, reason: 'SESSION_EXPIRED' })
  })

  it('shows a Partner manager setup sessions only, and denies an impersonation’s page', () => {
    const { server } = setup()
    expect(server.session('su-4K9', 'staff-partner-manager').kind).toBe('found')
    expect(server.session('imp-7Q2', 'staff-partner-manager')).toEqual({ kind: 'denied' })
    expect(server.session('nope', 'staff-partner-manager')).toEqual({ kind: 'notFound' })
    expect(server.session('imp-7Q2', 'staff-finance')).toEqual({ kind: 'denied' })
  })

  it('never puts the handoff token on a session record', async () => {
    const { server, impersonate } = setup()
    const started = await impersonate('s1-u1')
    if (!started.ok) throw new Error(started.reason)
    const token = tokenOf(started.handoff)
    expect(JSON.stringify(server.sessions({}, {}, 25, 'staff-super-admin'))).not.toContain(token)
    expect(JSON.stringify(server.mine('staff-super-admin'))).not.toContain(token)
  })
})

// Both sides read one server-shaped source: what the console does, the portal's next read shows.
describe('the two sides of one session', () => {
  it('opens the portal once from the handoff, in the words of the console that started it', async () => {
    const { impersonate } = setup()
    const portal = createPortalSessionFixture({ now: () => start, sample: () => ({ id: '', kind: 'impersonation', staffName: '', actingAs: null, partnerName: '', host: '', expiresAt: '' }) })
    const started = await impersonate('s1-u2', 'staff-super-admin')
    if (!started.ok) throw new Error(started.reason)
    const token = tokenOf(started.handoff)
    expect(started.handoff.startsWith('http://localhost:5173/impersonate/enter?token=')).toBe(true)
    const entered = portal.enter(token)
    expect(entered).toMatchObject({ id: started.session.id, state: 'open', staffName: 'Arjun Menon', actingAs: { name: 'Rohan Verma', role: 'Manager', where: 'Mehta Textiles' } })
    expect(portal.enter(token)).toBeNull()
  })

  it('carries an end from either side to the other', async () => {
    const { server, impersonate } = setup()
    const portal = createPortalSessionFixture({ now: () => start, sample: () => ({ id: '', kind: 'impersonation', staffName: '', actingAs: null, partnerName: '', host: '', expiresAt: '' }) })
    const first = await impersonate('s1-u2')
    if (!first.ok) throw new Error(first.reason)
    portal.enter(tokenOf(first.handoff))
    server.end(first.session.id, 'staff-super-admin')
    portal.endFromAdmin(first.session.id)
    expect(portal.current()).toMatchObject({ state: 'ended', endedBy: 'admin' })

    const second = await impersonate('s1-u3')
    if (!second.ok) throw new Error(second.reason)
    portal.enter(tokenOf(second.handoff))
    portal.end(second.session.id)
    server.endFromPortal(second.session.id)
    const lookup = server.session(second.session.id, 'staff-super-admin')
    expect(lookup.kind === 'found' && lookup.session.outcome).toBe('endedFromPortal')
    expect(portal.current()).toMatchObject({ state: 'ended', endedBy: 'portal' })
  })
})
