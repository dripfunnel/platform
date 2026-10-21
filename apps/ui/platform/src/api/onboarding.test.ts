import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { allChecksPass, sampleOnboarding } from '../features/onboarding/onboardingSample'
import { failingChecks, loadOnboarding, submitForApproval } from './onboarding'

const answer = vi.fn<() => Promise<Response>>()
const graphql = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }))

beforeEach(() => {
  answer.mockReset()
  vi.stubGlobal('fetch', () => answer())
})
afterEach(() => vi.unstubAllGlobals())

describe('loadOnboarding', () => {
  it('reads the checklist, the checks and the submit verdict as the API sends them', async () => {
    const onboarding = sampleOnboarding({ canSubmit: { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' } })
    answer.mockReturnValue(graphql({ data: { onboarding } }))
    expect(await loadOnboarding()).toEqual(onboarding)
  })

  it('refuses an item or a link it doesn’t know rather than drawing it', async () => {
    const drifted = { ...sampleOnboarding(), items: [{ key: 'newItem', status: 'done', detail: null, doneBy: null, to: '/settings' }] }
    answer.mockReturnValue(graphql({ data: { onboarding: drifted } }))
    await expect(loadOnboarding()).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
})

describe('failingChecks', () => {
  it('lists the checks the API says fail, in order, and none once all pass', () => {
    expect(failingChecks(sampleOnboarding())).toEqual(['portalHost', 'pricedPlan', 'legalPages'])
    expect(failingChecks(sampleOnboarding({ checks: allChecksPass }))).toEqual([])
  })
})

describe('submitForApproval', () => {
  it('reads success with its time', async () => {
    answer.mockReturnValue(graphql({ data: { submitForApproval: { ok: true, code: null, check: null, submittedAt: '2026-10-04T09:00:00.000Z' } } }))
    expect(await submitForApproval()).toEqual({ ok: true, submittedAt: '2026-10-04T09:00:00.000Z' })
  })

  it('passes the refusal through with the check that failed', async () => {
    answer.mockReturnValue(graphql({ data: { submitForApproval: { ok: false, code: 'GO_LIVE_CHECK_FAILED', check: 'legalPages', submittedAt: null } } }))
    expect(await submitForApproval()).toEqual({ ok: false, code: 'GO_LIVE_CHECK_FAILED', check: 'legalPages' })
  })

  it('words the access layer’s FORBIDDEN as the role refusal, and anything else as not connected', async () => {
    answer.mockReturnValueOnce(graphql({ errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] }))
    expect(await submitForApproval()).toEqual({ ok: false, code: 'OWNERS_AND_ADMINS_ONLY' })
    answer.mockReturnValueOnce(graphql({ data: { submitForApproval: { ok: false, code: 'SOMETHING_NEW', check: null, submittedAt: null } } }))
    expect(await submitForApproval()).toMatchObject({ ok: false, code: 'NOT_CONNECTED' })
    answer.mockReturnValueOnce(Promise.reject(new TypeError('Failed to fetch')))
    expect(await submitForApproval()).toEqual({ ok: false, code: 'NOT_CONNECTED' })
  })
})
