import { describe, expect, it } from 'vitest'
import { CloudflareRefused, CloudflareUnavailable } from './api'
import { cachePurgeClient } from './purge'

describe('cachePurgeClient', () => {
  it('purges the tags on the zone, 30 to a call', async () => {
    const calls: { url: string; tags: string[]; auth: string | null }[] = []
    const api = cachePurgeClient({
      token: 't',
      zoneId: 'z',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), tags: (JSON.parse(String(init?.body)) as { tags: string[] }).tags, auth: new Headers(init?.headers).get('authorization') })
        return new Response(JSON.stringify({ success: true }))
      },
    })
    const tags = Array.from({ length: 31 }, (_, i) => `df-store-${i}`)
    await api.purgeTags(tags)
    expect(calls.map((c) => [c.url, c.tags.length, c.auth])).toEqual([
      ['https://api.cloudflare.com/client/v4/zones/z/purge_cache', 30, 'Bearer t'],
      ['https://api.cloudflare.com/client/v4/zones/z/purge_cache', 1, 'Bearer t'],
    ])
  })

  it('tells an outage, which the outbox retries, from a refusal', async () => {
    const answering = (status: number, body: unknown = {}) => cachePurgeClient({ token: 't', zoneId: 'z', fetchImpl: async () => new Response(JSON.stringify(body), { status }) })
    await expect(answering(503).purgeTags(['a'])).rejects.toBeInstanceOf(CloudflareUnavailable)
    await expect(answering(403).purgeTags(['a'])).rejects.toBeInstanceOf(CloudflareUnavailable)
    await expect(answering(400).purgeTags(['a'])).rejects.toBeInstanceOf(CloudflareRefused)
    await expect(answering(200, { success: false }).purgeTags(['a'])).rejects.toBeInstanceOf(CloudflareUnavailable)
    const silent = cachePurgeClient({ token: 't', zoneId: 'z', fetchImpl: () => Promise.reject(new Error('down')) })
    await expect(silent.purgeTags(['a'])).rejects.toBeInstanceOf(CloudflareUnavailable)
  })
})
