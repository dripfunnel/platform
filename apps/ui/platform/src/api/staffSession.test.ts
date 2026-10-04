import { afterEach, describe, expect, it, vi } from 'vitest'
import { staffSession } from './staffSession'

afterEach(() => void vi.unstubAllGlobals())

const answers = (...bodies: unknown[]) => {
  let call = 0
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(bodies[Math.min(call++, bodies.length - 1)]), { headers: { 'content-type': 'application/json' } })))
}

const session = { id: 's1', kind: 'setup', state: 'open', endedBy: null, staffName: 'Arjun Menon', actingAs: null, partnerName: 'Northstar', host: 'platform.localhost', expiresAt: '2026-10-04T14:00:00.000Z' }

describe('the staff session poll', () => {
  it('keeps the last answer when the poll is over its limit, so the bar never errors mid-session', async () => {
    answers({ ok: true, session }, { ok: false, code: 'RATE_LIMITED' })
    expect(await staffSession.current()).toMatchObject({ id: 's1', kind: 'setup' })
    expect(await staffSession.current()).toMatchObject({ id: 's1', kind: 'setup' })
  })

  it('says an end that ended nothing failed', async () => {
    answers({ ok: false, code: 'SESSION_NOT_ENDED' })
    await expect(staffSession.end('s1')).rejects.toThrow()
  })
})
