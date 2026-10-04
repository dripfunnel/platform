import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endSupportSession, findPagesMax, findSupportTarget, loadSupportTargets, reauthenticate, startSupportSession } from './support'

// The support rules are the Platform API's (apps/api tests/platform-support); these check the client.
const answer = vi.fn<(body: { query: string; variables?: Record<string, unknown> }) => unknown>()
beforeEach(() => {
  answer.mockReset()
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => Promise.resolve(new Response(JSON.stringify(answer(JSON.parse(String(init.body)) as { query: string })))))
})
afterEach(() => void vi.unstubAllGlobals())

const pageInfo = { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }
const row = {
  membershipId: 'm1',
  userId: 'u1',
  name: 'Jenna Park',
  email: 'jenna@juniper.example',
  type: 'store',
  store: { id: 's1', name: 'Juniper & Co.' },
  role: 'owner',
  supplier: null,
  lastSignInAt: null,
  status: 'active',
  storeOwner: 'Jenna Park',
  colleague: null,
  mySessionId: null,
}

describe('support', () => {
  it('reads each user’s verdict by code, and errors on a code it doesn’t know', async () => {
    answer.mockReturnValueOnce({ data: { supportTargets: { items: [{ ...row, start: { allowed: false, reason: 'SUPPORT_OFF' } }], pageInfo } } })
    const page = await loadSupportTargets('jen', {})
    expect(page.items[0]?.start).toEqual({ allowed: false, reason: 'SUPPORT_OFF' })
    expect(answer.mock.calls[0]?.[0].variables).toMatchObject({ search: 'jen' })
    answer.mockReturnValueOnce({ data: { supportTargets: { items: [{ ...row, start: { allowed: false, reason: 'SOMETHING_NEW' } }], pageInfo } } })
    await expect(loadSupportTargets(undefined, {})).rejects.toMatchObject({ code: 'SOMETHING_NEW' })
  })

  it('gives the proof, or why the code was refused with the tries left', async () => {
    answer.mockReturnValueOnce({ data: { reauthenticate: { ok: true, reason: null, proof: 'p', triesLeft: null, lockedMinutes: null } } })
    expect(await reauthenticate('123456')).toEqual({ ok: true, proof: 'p' })
    answer.mockReturnValueOnce({ data: { reauthenticate: { ok: false, reason: 'WRONG_CODE', proof: null, triesLeft: 2, lockedMinutes: null } } })
    expect(await reauthenticate('000000')).toEqual({ ok: false, reason: 'WRONG_CODE', triesLeft: 2, lockedMinutes: null })
  })

  it('opens only an https link, and names the open session a second start runs into', async () => {
    const input = { membershipId: 'm1', reason: 'Tax', ticket: null, proof: 'p' }
    answer.mockReturnValueOnce({ data: { startSupportSession: { ok: true, reason: null, sessionId: 'ss1', link: 'https://shop.northstar.example/support/enter?token=t' } } })
    expect(await startSupportSession(input)).toEqual({ ok: true, link: 'https://shop.northstar.example/support/enter?token=t' })
    answer.mockReturnValueOnce({ data: { startSupportSession: { ok: true, reason: null, sessionId: 'ss1', link: 'javascript:alert(1)' } } })
    await expect(startSupportSession(input)).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    answer.mockReturnValueOnce({ data: { startSupportSession: { ok: false, reason: 'SUPPORT_SESSION_ALREADY_OPEN', sessionId: 'ss0', link: null } } })
    expect(await startSupportSession(input)).toEqual({ ok: false, reason: 'SUPPORT_SESSION_ALREADY_OPEN', sessionId: 'ss0' })
  })

  it('ends a session, or says why not', async () => {
    answer.mockReturnValueOnce({ data: { endSupportSession: { ok: false, reason: 'NOT_SESSION_OWNER' } } })
    expect(await endSupportSession('ss1')).toEqual({ ok: false, reason: 'NOT_SESSION_OWNER' })
  })

  it('finds one user’s row in one store past the first page, and stops at the page limit', async () => {
    const other = { ...row, membershipId: 'm0', store: { id: 's0', name: 'Elsewhere' }, start: { allowed: true, reason: null } }
    const wanted = { ...row, start: { allowed: true, reason: null } }
    answer
      .mockReturnValueOnce({ data: { supportTargets: { items: [other], pageInfo: { ...pageInfo, hasNextPage: true, endCursor: 'c1' } } } })
      .mockReturnValueOnce({ data: { supportTargets: { items: [wanted], pageInfo } } })
    expect((await findSupportTarget({ id: 'u1', email: 'jenna@juniper.example' }, 's1'))?.membershipId).toBe('m1')
    expect(answer.mock.calls.map((call) => call[0].variables)).toEqual([
      { search: 'jenna@juniper.example' },
      { search: 'jenna@juniper.example', after: 'c1' },
    ])
    answer.mockReset()
    answer.mockReturnValue({ data: { supportTargets: { items: [other], pageInfo: { ...pageInfo, hasNextPage: true, endCursor: 'c' } } } })
    expect(await findSupportTarget({ id: 'u1', email: 'jenna@juniper.example' }, 's1')).toBeNull()
    expect(answer).toHaveBeenCalledTimes(findPagesMax)
  })

  it('reports a person missing when the last page has no such row', async () => {
    answer.mockReturnValueOnce({ data: { supportTargets: { items: [{ ...row, store: { id: 's0', name: 'Elsewhere' }, start: { allowed: true, reason: null } }], pageInfo } } })
    expect(await findSupportTarget({ id: 'u1', email: 'jenna@juniper.example' }, 's1')).toBeNull()
    expect(answer).toHaveBeenCalledTimes(1)
  })
})
