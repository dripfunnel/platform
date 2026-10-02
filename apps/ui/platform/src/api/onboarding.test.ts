import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { partnerRoles } from '../features/shell/partnerRoles'
import { failingCheck, itemsLeft, onboardingFor, partnerOnlyItems, runTestSignup, submitForApproval } from './onboarding'

const settled = async <T,>(promise: Promise<T>): Promise<T> => {
  await vi.advanceTimersByTimeAsync(400)
  return promise
}

describe('submitting for approval', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each(partnerRoles.filter((role) => role !== 'partner-owner' && role !== 'partner-admin'))('is refused for %s', async (role) => {
    expect(await settled(submitForApproval(role, onboardingFor('sentback', 'partner')))).toEqual({ ok: false, code: 'OWNERS_AND_ADMINS_ONLY' })
    expect(await settled(runTestSignup(role))).toEqual({ ok: false, code: 'OWNERS_AND_ADMINS_ONLY' })
  })

  it('is refused while a go-live check fails, naming the check (SAAS §3.2 step 3)', async () => {
    const draft = onboardingFor('draft', 'partner')
    expect(failingCheck(draft)).toBe('portalHost')
    expect(await settled(submitForApproval('partner-owner', draft))).toEqual({ ok: false, code: 'GO_LIVE_CHECK_FAILED', check: 'portalHost' })
    const sentBack = onboardingFor('sentback', 'dripfunnel')
    expect(await settled(submitForApproval('partner-admin', sentBack))).toEqual({ ok: false, code: 'GO_LIVE_CHECK_FAILED', check: 'legalPages' })
  })

  it('never counts payment method or payout details as a check or as an item left', () => {
    const ready = { ...onboardingFor('awaiting', 'partner'), state: 'draft' as const }
    expect(ready.items.filter((x) => partnerOnlyItems.includes(x.key)).every((x) => x.status === 'missing')).toBe(true)
    expect(failingCheck(ready)).toBeNull()
    expect(itemsLeft(ready)).toBe(0)
  })

  it('succeeds for an Owner once every check passes, and refuses a second submit', async () => {
    const ready = { ...onboardingFor('awaiting', 'partner'), state: 'draft' as const }
    const result = await settled(submitForApproval('partner-owner', ready))
    expect(result.ok).toBe(true)
    expect(await settled(submitForApproval('partner-owner', onboardingFor('awaiting', 'partner')))).toEqual({ ok: false, code: 'ALREADY_SUBMITTED' })
  })
})

describe('who completed what', () => {
  it('marks only staff-completed items as done by DripFunnel', () => {
    const byPartner = onboardingFor('draft', 'partner')
    expect(byPartner.items.filter((x) => x.doneBy === 'DripFunnel').map((x) => x.key)).toEqual(['company'])
    const byStaff = onboardingFor('awaiting', 'dripfunnel')
    expect(byStaff.items.filter((x) => x.status === 'done').every((x) => x.doneBy === 'DripFunnel')).toBe(true)
    expect(byStaff.items.filter((x) => partnerOnlyItems.includes(x.key)).every((x) => x.doneBy === null)).toBe(true)
  })
})
