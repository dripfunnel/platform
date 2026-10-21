import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadTranslationProgress } from './settings'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('translation progress', () => {
  it('asks for every language in one request, each answer under its own language', async () => {
    const sent: { variables: Record<string, string> }[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as { variables: Record<string, string> })
      return new Response(JSON.stringify({ data: { l0: { products: 40, untranslated: 12 }, l1: null } }))
    })
    const progress = await loadTranslationProgress(['hi-IN', 'en-US'])
    expect(sent).toHaveLength(1)
    expect(sent[0]?.variables).toEqual({ l0: 'hi-IN', l1: 'en-US' })
    expect([...progress]).toEqual([['hi-IN', { products: 40, untranslated: 12 }], ['en-US', null]])
  })

  it('sends nothing when there is only the main language', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect((await loadTranslationProgress([])).size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
})
