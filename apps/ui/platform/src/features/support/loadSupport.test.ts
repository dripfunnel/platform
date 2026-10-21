import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSupport } from './loadSupport'

const fetched = vi.fn<(body: { query: string }) => unknown>()
beforeEach(() => {
  fetched.mockReset()
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => Promise.resolve(new Response(JSON.stringify(fetched(JSON.parse(String(init.body)) as { query: string })))))
})
afterEach(() => void vi.unstubAllGlobals())

const empty = { items: [], pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false } }

describe('loadSupport', () => {
  it('asks nothing for a role without Support', async () => {
    for (const role of ['partner-finance', 'partner-read-only'] as const) expect(await loadSupport(role, 'users')).toEqual({ refused: true })
    expect(fetched).not.toHaveBeenCalled()
  })

  it('reads the open sessions and your own on both tabs, and only the tab’s list', async () => {
    fetched.mockImplementation(({ query }) =>
      query.includes('mySupportSession') ? { data: { mySupportSession: null } } : query.includes('supportTargets') ? { data: { supportTargets: empty } } : { data: { supportSessions: empty } },
    )
    const users = await loadSupport('partner-support', 'users')
    expect(users).toMatchObject({ refused: false, mine: null, history: null, users: empty })
    const sessions = await loadSupport('partner-admin', 'sessions')
    expect(sessions).toMatchObject({ refused: false, users: null, history: empty })
    expect(fetched.mock.calls.filter(([body]) => body.query.includes('supportTargets'))).toHaveLength(1)
  })
})
