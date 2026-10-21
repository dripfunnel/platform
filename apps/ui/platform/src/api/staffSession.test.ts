import { afterEach, describe, expect, it, vi } from 'vitest'
import { staffSession } from './staffSession'

afterEach(() => void vi.unstubAllGlobals())

const answers = (...bodies: unknown[]) => {
  let call = 0
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(bodies[Math.min(call++, bodies.length - 1)]), { headers: { 'content-type': 'application/json' } })))
}

const session = { id: 's1', kind: 'setup', state: 'open', endedBy: null, staffName: 'Arjun Menon', actingAs: null, partnerName: 'Northstar', host: 'platform.localhost', expiresAt: '2026-10-04T14:00:00.000Z' }

describe('the staff session poll', () => {
  it('rejects a refused poll rather than answering "no session", then reads the next answer', async () => {
    answers({ ok: false, code: 'RATE_LIMITED' }, { ok: true, session })
    await expect(staffSession.current()).rejects.toThrow()
    expect(await staffSession.current()).toMatchObject({ id: 's1', kind: 'setup' })
  })

  it('says an end that ended nothing failed', async () => {
    answers({ ok: false, code: 'SESSION_NOT_ENDED' })
    await expect(staffSession.end('s1')).rejects.toThrow()
  })
})
