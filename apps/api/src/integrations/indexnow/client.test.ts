import { describe, expect, it } from 'vitest'
import { IndexNowRefused, IndexNowUnavailable, indexNowClient } from './client'

const recording = (statuses: (number | Error)[]) => {
  const calls: { url: string; body: unknown; signal: unknown }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), signal: init?.signal })
    const next = statuses.shift() ?? 200
    if (next instanceof Error) throw next
    return new Response(null, { status: next })
  }) as typeof fetch
  return { calls, fetchImpl }
}

describe('the IndexNow client', () => {
  it('names the host, the key and where the key is, with a timeout, in calls of at most 10,000 addresses', async () => {
    const { calls, fetchImpl } = recording([202, 200])
    const urls = Array.from({ length: 10_001 }, (_, i) => `https://shop.example/p/${i}`)
    await indexNowClient({ fetchImpl }).submit({ host: 'shop.example', key: 'k'.repeat(32), urls })
    expect(calls.map((c) => (c.body as { urlList: string[] }).urlList.length)).toEqual([10_000, 1])
    expect(calls[0]?.body).toMatchObject({ host: 'shop.example', key: 'k'.repeat(32), keyLocation: `https://shop.example/${'k'.repeat(32)}.txt` })
    expect(calls[0]?.url).toBe('https://api.indexnow.org/indexnow')
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('says whether to try again: no answer, 429 and 5xx later; 403 and 422 never', async () => {
    const submit = (status: number | Error) => indexNowClient({ fetchImpl: recording([status]).fetchImpl }).submit({ host: 'h.example', key: 'k'.repeat(32), urls: ['https://h.example/'] })
    await expect(submit(new Error('reset'))).rejects.toBeInstanceOf(IndexNowUnavailable)
    await expect(submit(429)).rejects.toBeInstanceOf(IndexNowUnavailable)
    await expect(submit(503)).rejects.toBeInstanceOf(IndexNowUnavailable)
    await expect(submit(403)).rejects.toBeInstanceOf(IndexNowRefused)
    await expect(submit(422)).rejects.toBeInstanceOf(IndexNowRefused)
  })
})
