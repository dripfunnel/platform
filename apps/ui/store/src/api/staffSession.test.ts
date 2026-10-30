import { afterEach, describe, expect, it, vi } from 'vitest'
import { actingStore, rememberActing } from '../acting'
import { staffSession } from './staffSession'

const answer = (session: unknown) => {
  const calls: { url: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (url: string, request: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(request.body)) })
    return new Response(JSON.stringify(session === null ? { ok: false, code: 'HANDOFF_INVALID' } : { ok: true, session }))
  })
  return calls
}

const open = {
  id: 'imp-1',
  kind: 'impersonation',
  state: 'open',
  endedBy: null,
  staffName: 'Neha Rao',
  actingAs: { name: 'Nadia Tran', role: 'supplier-admin', store: 'Mehta Textiles', supplier: 'Anand Weaves' },
  partnerName: 'Bazaar Cloud',
  host: 'store.bazaarcloud.in',
  expiresAt: '2026-10-30T09:30:00Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the store’s staff-session exchange (ACCESS.md §8.3)', () => {
  it('posts the token in the body and words the user’s role and seat', async () => {
    const calls = answer(open)
    rememberActing({ storeId: 'another-store', supplierId: null })
    const session = await staffSession.exchange('tok')
    expect(calls).toEqual([{ url: '/api/auth/handoff', body: { token: 'tok' } }])
    expect(session?.actingAs).toEqual({ name: 'Nadia Tran', role: 'Supplier admin', where: 'Anand Weaves · Mehta Textiles' })
    // A store remembered from before would name another store than the session's.
    expect(actingStore()).toBeNull()
  })

  it('answers no session for a refused link', async () => {
    answer(null)
    expect(await staffSession.exchange('spent')).toBeNull()
  })
})
