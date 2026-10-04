import { describe, expect, it, vi } from 'vitest'
import type { ImpersonationTarget, StaffSession, StartResult } from '../../api/impersonation'
import { createImpersonationServer } from '../../api/impersonationSample'
import { countedSteps, firstStep, startWithReauth, type StartSubject } from './startFlow'

const server = createImpersonationServer({ reauthDelayMs: 0 })
const targetOf = (membershipId: string): ImpersonationTarget => {
  const target = server.target(membershipId, 'staff-super-admin')
  if (!target) throw new Error(`No sample target ${membershipId}`)
  return target
}
const impersonating = (target: ImpersonationTarget, membershipId: string | null = null): StartSubject => ({ kind: 'impersonation', target, membershipId })
const openSession = (kind: StaffSession['kind'], partnerId = 'ts'): StaffSession => ({
  id: 'x',
  kind,
  staff: { id: 'st-arjun', name: 'Arjun Menon' },
  target: null,
  membership: null,
  partner: { id: partnerId, name: partnerId },
  store: null,
  host: 'platform.dripfunnel.com',
  reason: 'r',
  ticket: null,
  startedAt: '2026-10-01T09:00:00Z',
  expiresAt: '2026-10-01T09:30:00Z',
  endedAt: null,
  extendedAt: null,
  outcome: 'open',
  mine: true,
  actions: {},
})

describe('where the start flow opens', () => {
  it('refuses first, then returns, then asks about the open one, then the questions', () => {
    const active = targetOf('s1-u1')
    expect(firstStep(impersonating(targetOf('s1-u4')), [])).toBe('blocked')
    expect(firstStep(impersonating({ ...active, openSession: 'imp-1' }), [openSession('impersonation')])).toBe('return')
    expect(firstStep(impersonating(active), [openSession('impersonation')])).toBe('busy')
    expect(firstStep(impersonating(active), [openSession('setup')])).toBe('why')
  })

  it('asks where only when the user has more than one place and none was picked', () => {
    const many = { ...targetOf('s1-u1'), memberships: [...targetOf('s1-u1').memberships, ...targetOf('s1-u2').memberships] }
    expect(firstStep(impersonating(many), [])).toBe('where')
    expect(countedSteps(impersonating(many), false)).toEqual(['where', 'why', 'confirm'])
    expect(firstStep(impersonating(many, 's1-u2'), [])).toBe('why')
    expect(countedSteps(impersonating(many, 's1-u2'), true)).toEqual(['why', 'confirm'])
  })

  it('returns to a setup session for the same partner, and stops at another', () => {
    const subject: StartSubject = { kind: 'setup', partner: { id: 'ts', name: 'Tallis Studio' } }
    expect(firstStep(subject, [openSession('setup', 'ts')])).toBe('return')
    expect(firstStep(subject, [openSession('setup', 'kl')])).toBe('busy')
    expect(firstStep(subject, [openSession('impersonation')])).toBe('why')
  })
})

describe('startWithReauth', () => {
  const ok = { ok: true as const, session: {} as never, handoff: 'https://x/enter' }
  const reauth = { ok: false as const, reason: 'REAUTH_REQUIRED' as const }

  it('starts at once when the last sign-in is fresh, without asking for another', async () => {
    const signIn = vi.fn()
    expect(await startWithReauth(() => Promise.resolve(ok), signIn, false)).toEqual({ kind: 'done', result: ok })
    expect(signIn).not.toHaveBeenCalled()
  })

  it('signs in again on REAUTH_REQUIRED and asks once more', async () => {
    const start = vi.fn<() => Promise<StartResult>>().mockResolvedValueOnce(reauth).mockResolvedValueOnce(ok)
    expect(await startWithReauth(start, () => Promise.resolve({ ok: true }), false)).toEqual({ kind: 'done', result: ok })
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('reads a second REAUTH_REQUIRED as a sign-in that failed, whatever page the tab reached', async () => {
    expect(await startWithReauth(() => Promise.resolve(reauth), () => Promise.resolve({ ok: true }), false)).toEqual({ kind: 'signIn', outcome: 'failed' })
  })

  it('passes a cancelled sign-in through, and says a blocked tab can’t sign in', async () => {
    expect(await startWithReauth(() => Promise.resolve(reauth), () => Promise.resolve({ ok: false, outcome: 'cancelled' }), false)).toEqual({ kind: 'signIn', outcome: 'cancelled' })
    const signIn = vi.fn()
    expect(await startWithReauth(() => Promise.resolve(reauth), signIn, true)).toEqual({ kind: 'signIn', outcome: 'blocked' })
    expect(signIn).not.toHaveBeenCalled()
  })
})
