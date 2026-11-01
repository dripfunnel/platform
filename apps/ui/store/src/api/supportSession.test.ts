import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { actingStore, rememberActing } from '../acting'
import { exchangeSupportHandoff } from './supportSession'

const answering = (body: unknown) => {
  const sent: { url: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify(body))
  })
  return sent
}

describe('exchangeSupportHandoff (#1112)', () => {
  beforeEach(() => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) })
    rememberActing({ storeId: 'other-store', supplierId: null })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts the token in the body, and forgets a remembered store once the session is open', async () => {
    const sent = answering({ ok: true, session: { id: 'sup-1', state: 'open' } })
    expect(await exchangeSupportHandoff('tok')).toBe(true)
    expect(sent).toEqual([{ url: '/api/auth/support-handoff', body: { token: 'tok' } }])
    expect(actingStore()).toBeNull()
  })

  it('answers false for a link that no longer works, keeping the remembered store', async () => {
    answering({ ok: false, code: 'HANDOFF_INVALID' })
    expect(await exchangeSupportHandoff('spent')).toBe(false)
    expect(actingStore()).toEqual({ storeId: 'other-store', supplierId: null })
  })

  it('throws when the API does not answer, which the page reads as a spent link', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(exchangeSupportHandoff('tok')).rejects.toThrow()
  })
})
