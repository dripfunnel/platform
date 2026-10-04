import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeTeamRole, inviteTeamMember, loadSettings, transferOwnership } from './settings'

// The team rules are the Platform API's (apps/api tests/platform-settings); these check the client.
const answer = vi.fn<(body: { query: string; variables?: Record<string, unknown> }) => unknown>()
beforeEach(() => {
  answer.mockReset()
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => Promise.resolve(new Response(JSON.stringify(answer(JSON.parse(String(init.body)) as { query: string })))))
})
afterEach(() => void vi.unstubAllGlobals())

describe('settings', () => {
  it('reads the company and the team', async () => {
    answer.mockReturnValue({
      data: {
        partnerCompany: { name: 'Northstar', country: 'US', region: null, kind: null, mainContact: null, billingContact: null, contract: null, secondFactorRequired: true },
        team: { items: [{ id: 'u1', name: 'Maya', email: 'm@x', role: 'partner-owner', status: 'active', you: true, lastSignInAt: null, invitation: null, secondFactor: true }], pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false } },
      },
    })
    const settings = await loadSettings()
    expect(settings.company.secondFactorRequired).toBe(true)
    expect(settings.team.items[0]).toMatchObject({ you: true, role: 'partner-owner' })
  })

  it('reads each change’s refusal by code, and errors on a code it doesn’t know', async () => {
    answer.mockReturnValueOnce({ data: { inviteTeamMember: { ok: false, reason: 'ALREADY_ON_TEAM' } } })
    expect(await inviteTeamMember({ name: 'Sam', email: 's@x', role: 'partner-support' })).toEqual({ ok: false, reason: 'ALREADY_ON_TEAM' })
    answer.mockReturnValueOnce({ data: { changeTeamRole: { ok: true, reason: null } } })
    expect(await changeTeamRole('u2', 'partner-finance')).toEqual({ ok: true })
    expect(answer.mock.calls[1]?.[0].variables).toEqual({ id: 'u2', role: 'partner-finance' })
    answer.mockReturnValueOnce({ data: { transferOwnership: { ok: false, reason: 'SOMETHING_NEW' } } })
    await expect(transferOwnership('u2')).rejects.toMatchObject({ code: 'SOMETHING_NEW' })
  })
})
