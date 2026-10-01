import { describe, expect, it } from 'vitest'
import { staffRoles } from '../features/shell/staffRoles'
import { createStaffServer } from './staffSample'

const now = Date.parse('2026-10-01T09:00:00Z')
const dayMs = 86_400_000
const superAdmin = 'staff-super-admin'

const serverAt = () => {
  let clock = now
  const server = createStaffServer({ now: () => clock })
  const all = () => server.list({}, 50, superAdmin)?.items ?? []
  return { server, all, member: (id: string) => all().find((member) => member.id === id), advance: (days: number) => void (clock += days * dayMs) }
}

const others = staffRoles.filter((role) => role !== superAdmin)

describe('the sample Staff server', () => {
  it.each(others)('answers no list and refuses every change for %s', (role) => {
    const { server } = serverAt()
    expect(server.list({}, 50, role)).toBeNull()
    const refused = { ok: false, reason: 'SUPER_ADMIN_ONLY' }
    expect(server.invite('new@dripfunnel.com', 'staff-support', role)).toEqual(refused)
    expect(server.changeRole('st-neha', 'staff-finance', role)).toEqual(refused)
    expect(server.remove('st-neha', role)).toEqual(refused)
    expect(server.resend('st-kiran', role)).toEqual(refused)
    expect(server.revoke('st-kiran', role)).toEqual(refused)
  })

  it('pages by cursor both ways, with no total', () => {
    const { server } = serverAt()
    const first = server.list({}, 3, superAdmin)
    expect(first?.items).toHaveLength(3)
    expect(first?.pageInfo).toMatchObject({ hasPreviousPage: false, hasNextPage: true })
    expect(Object.keys(first ?? {})).not.toContain('total')
    const second = server.list({ after: first?.pageInfo.endCursor ?? undefined }, 3, superAdmin)
    expect(second?.pageInfo.hasPreviousPage).toBe(true)
    const back = server.list({ before: second?.pageInfo.startCursor ?? undefined }, 3, superAdmin)
    expect(back?.items.map((member) => member.id)).toEqual(first?.items.map((member) => member.id))
  })

  it('gives the §10 fields, and an invitation only its dates, never a link or token', () => {
    const { all, member } = serverAt()
    expect(member('st-arjun')).toMatchObject({ name: 'Arjun Menon', email: 'arjun@dripfunnel.com', role: superAdmin, twoFactor: 'on', invitation: null })
    expect(member('st-sam')?.twoFactor).toBe('off')
    expect(member('st-kiran')).toMatchObject({ name: null, twoFactor: 'notSignedIn', invitation: { expired: false } })
    expect(member('st-noor')?.invitation?.expired).toBe(true)
    expect(Object.keys(member('st-kiran')?.invitation ?? {}).sort()).toEqual(['expired', 'expiresAt', 'sentAt'])
    expect(JSON.stringify(all())).not.toMatch(/token|accept-invite|https?:/i)
  })
})

describe('the last Super admin', () => {
  it('is refused removal and demotion by the server, with LAST_SUPER_ADMIN, and the record says so', () => {
    const { server, member } = serverAt()
    expect(server.list({}, 50, superAdmin)?.soleSuperAdmin).toBe(true)
    expect(member('st-arjun')?.actions).toEqual({ changeRole: { allowed: false, reason: 'LAST_SUPER_ADMIN' }, remove: { allowed: false, reason: 'LAST_SUPER_ADMIN' } })
    expect(server.remove('st-arjun', superAdmin)).toEqual({ ok: false, reason: 'LAST_SUPER_ADMIN' })
    expect(server.changeRole('st-arjun', 'staff-support', superAdmin)).toEqual({ ok: false, reason: 'LAST_SUPER_ADMIN' })
    expect(member('st-arjun')?.role).toBe(superAdmin)
  })

  it('still lets them manage everyone else', () => {
    const { server, member } = serverAt()
    expect(member('st-neha')?.actions.remove).toEqual({ allowed: true })
    expect(server.changeRole('st-neha', 'staff-finance', superAdmin)).toEqual({ ok: true })
    expect(server.remove('st-sam', superAdmin)).toEqual({ ok: true })
    expect(member('st-sam')).toBeUndefined()
  })

  it('does not count an invitation that was never accepted', () => {
    const { server, member } = serverAt()
    expect(server.invite('second@dripfunnel.com', superAdmin, superAdmin)).toEqual({ ok: true })
    expect(server.list({}, 50, superAdmin)?.soleSuperAdmin).toBe(true)
    expect(server.remove('st-arjun', superAdmin)).toEqual({ ok: false, reason: 'LAST_SUPER_ADMIN' })
    expect(member('st-arjun')?.actions.changeRole).toEqual({ allowed: false, reason: 'LAST_SUPER_ADMIN' })
  })

  it('lets a Super admin demote themselves once there is another, and then protects the other', () => {
    const { server, member } = serverAt()
    expect(server.changeRole('st-maya', superAdmin, superAdmin)).toEqual({ ok: true })
    expect(server.list({}, 50, superAdmin)?.soleSuperAdmin).toBe(false)
    expect(member('st-arjun')?.actions.changeRole).toEqual({ allowed: true })
    expect(server.changeRole('st-arjun', 'staff-support', superAdmin)).toEqual({ ok: true })
    expect(server.remove('st-maya', superAdmin)).toEqual({ ok: false, reason: 'LAST_SUPER_ADMIN' })
  })
})

describe('invitations', () => {
  it('invite any address once, whatever its case', () => {
    const { server, member, all } = serverAt()
    expect(server.invite('Someone@Example.org', 'staff-finance', superAdmin)).toEqual({ ok: true })
    expect(all().some((one) => one.email === 'someone@example.org' && one.invitation !== null)).toBe(true)
    expect(server.invite('NEHA@dripfunnel.com', 'staff-support', superAdmin)).toEqual({ ok: false, reason: 'ALREADY_STAFF' })
    expect(server.invite('kiran@dripfunnel.com', 'staff-support', superAdmin)).toEqual({ ok: false, reason: 'ALREADY_STAFF' })
    expect(member('st-kiran')?.actions).toEqual({ changeRole: { allowed: true }, resend: { allowed: true }, revoke: { allowed: true } })
  })

  it('resend gives an expired invitation a new 7 days', () => {
    const { server, member } = serverAt()
    expect(server.resend('st-noor', superAdmin)).toEqual({ ok: true })
    expect(member('st-noor')?.invitation).toEqual({ sentAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * dayMs).toISOString(), expired: false })
  })

  it('expires a pending invitation after 7 days', () => {
    const { member, advance } = serverAt()
    advance(5)
    expect(member('st-kiran')?.invitation?.expired).toBe(true)
  })

  it('revoke removes an invitation, and each action keeps to its kind of row', () => {
    const { server, member } = serverAt()
    expect(server.remove('st-kiran', superAdmin)).toEqual({ ok: false, reason: 'PENDING_INVITATION' })
    expect(server.resend('st-neha', superAdmin)).toEqual({ ok: false, reason: 'NOT_PENDING' })
    expect(server.revoke('st-neha', superAdmin)).toEqual({ ok: false, reason: 'NOT_PENDING' })
    expect(server.revoke('st-kiran', superAdmin)).toEqual({ ok: true })
    expect(member('st-kiran')).toBeUndefined()
  })

  it('refuses a role change to the same role, and one for someone no longer on staff', () => {
    const { server } = serverAt()
    expect(server.changeRole('st-neha', 'staff-support', superAdmin)).toEqual({ ok: false, reason: 'SAME_ROLE' })
    expect(server.changeRole('st-gone', 'staff-support', superAdmin)).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })
})
