import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('Edit text’s languages', () => {
  it('are the store’s own active languages, the main one first, never the whole list a store may add', async () => {
    const storeLocale = { mainLanguage: 'en-IN', languages: [{ code: 'hi-IN', status: 'active' }, { code: 'en-IN', status: 'active' }, { code: 'en-US', status: 'removed' }] }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { storeLocale } })))
    const { loadStudioLanguages } = await import('./studio')
    expect(await loadStudioLanguages()).toEqual(['en-IN', 'hi-IN'])
  })
})
