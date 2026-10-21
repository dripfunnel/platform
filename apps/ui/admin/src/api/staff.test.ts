import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from '../testing/apiStub'
import { inviteStaff, loadStaff, removeStaff } from './staff'

afterEach(() => void vi.unstubAllGlobals())

const permission = (allowed: boolean, reason: string | null = null) => ({ allowed, reason, failingChecks: null })
const member = { id: 'st1', name: 'Neha Rao', email: 'neha@x.example', role: 'staff-support', lastSignInAt: null, twoFactor: 'notSignedIn', invitation: null, actions: { changeRole: permission(true), remove: permission(false, 'LAST_SUPER_ADMIN'), resend: null, revoke: null } }

describe('loadStaff', () => {
  it('reads the members with their action blocks, for a Super admin only', async () => {
    stubApi({ data: { staff: { items: [member], pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }, soleSuperAdmin: true } } })
    const page = await loadStaff({}, 'staff-super-admin')
    expect(page?.items[0]?.actions).toEqual({ changeRole: { allowed: true }, remove: { allowed: false, reason: 'LAST_SUPER_ADMIN' } })
    expect(page?.soleSuperAdmin).toBe(true)
    expect(await loadStaff({}, 'staff-support')).toBeNull()
  })
})

describe('the staff writes', () => {
  it('read a refusal by its code, and the access layer’s FORBIDDEN as SUPER_ADMIN_ONLY', async () => {
    stubApi({ data: { inviteStaff: { ok: false, reason: 'ALREADY_STAFF' } } })
    expect(await inviteStaff('neha@x.example', 'staff-support')).toEqual({ ok: false, reason: 'ALREADY_STAFF' })
    stubApi({ errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] })
    expect(await removeStaff('st1')).toEqual({ ok: false, reason: 'SUPER_ADMIN_ONLY' })
    stubApi({ data: { removeStaff: { ok: true, reason: null } } })
    expect(await removeStaff('st1')).toEqual({ ok: true })
  })
})
