import { describe, expect, it } from 'vitest'
import { httpEdgeProbe } from './edgeProbe'

const answer = (status: number, headers: Record<string, string> = {}, body = '') => new Response(status === 301 || status === 302 ? null : body, { status, headers })

const recording = (answers: (Response | Error)[]) => {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const next = answers.shift()
    if (!next || next instanceof Error) throw next ?? new Error('no answer')
    return next
  }) as typeof fetch
  return { calls, fetchImpl }
}

describe('the post-deploy checks’ HTTP probe', () => {
  it('reads the page, its type and the build the edge served it from, with a timeout on every call', async () => {
    const { calls, fetchImpl } = recording([answer(200, { 'content-type': 'text/html', 'x-df-build': 'b1' }, '<h1>Hi</h1>')])
    const probe = httpEdgeProbe({ fetchImpl, sleep: async () => undefined })
    expect(await probe.get('https://shop.example/')).toEqual({ status: 200, contentType: 'text/html', build: 'b1', body: '<h1>Hi</h1>' })
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
    expect(calls[0]?.init?.redirect).toBe('manual')
  })

  it('tries a failure that may pass with growing waits, three times in all, and takes a 4xx at once', async () => {
    const waits: number[] = []
    const failing = recording([new Error('reset'), answer(503), answer(502)])
    const probe = httpEdgeProbe({ fetchImpl: failing.fetchImpl, sleep: async (ms) => void waits.push(ms) })
    expect((await probe.get('https://shop.example/'))?.status).toBe(502)
    expect(failing.calls).toHaveLength(3)
    expect(waits).toEqual([500, 1500])
    const missing = recording([answer(404)])
    expect((await httpEdgeProbe({ fetchImpl: missing.fetchImpl }).get('https://shop.example/x'))?.status).toBe(404)
    expect(missing.calls).toHaveLength(1)
    const gone = recording([new Error('a'), new Error('b'), new Error('c')])
    expect(await httpEdgeProbe({ fetchImpl: gone.fetchImpl, sleep: async () => undefined }).get('https://shop.example/')).toEqual({ status: 0, contentType: '', build: null, body: '' })
  })

  it('follows the store’s own redirects, never one to another host', async () => {
    const own = recording([answer(301, { location: '/en' }), answer(200, { 'content-type': 'text/html' })])
    expect((await httpEdgeProbe({ fetchImpl: own.fetchImpl }).get('https://shop.example/'))?.status).toBe(200)
    expect(own.calls.map((c) => c.url)).toEqual(['https://shop.example/', 'https://shop.example/en'])
    const away = recording([answer(302, { location: 'https://elsewhere.example/' })])
    expect((await httpEdgeProbe({ fetchImpl: away.fetchImpl }).get('https://shop.example/'))?.status).toBe(302)
    expect(away.calls).toHaveLength(1)
  })

  it('asks the Shop API on the store’s own host and says whether it answered with errors', async () => {
    const { calls, fetchImpl } = recording([answer(200, {}, JSON.stringify({ data: { paymentOptions: [] } })), answer(200, {}, JSON.stringify({ errors: [{ message: 'x' }] }))])
    const probe = httpEdgeProbe({ fetchImpl })
    expect(await probe.shop('shop.example', 'query { x }', {})).toEqual({ status: 200, data: { paymentOptions: [] }, errors: false })
    expect(await probe.shop('shop.example', 'query { x }', {})).toEqual({ status: 200, data: null, errors: true })
    expect(calls[0]?.url).toBe('https://shop.example/shop-api')
    expect(calls[0]?.init?.method).toBe('POST')
  })
})
