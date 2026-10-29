import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayError, transientCodes } from './gateway'
import { openaiChat } from './openaiChat'
import { capabilityOf, costOf, modelsOf } from './registry'
import { withRetry } from './retry'

const key = 'sk-proj-SECRETSECRETSECRETSECRET'
const request = { model: 'gpt-5', system: 'Be brief.', messages: [{ role: 'user' as const, content: 'Hi' }], maxTokens: 50 }
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
const sse = (lines: string[]) => new Response(new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode(lines.join('\n'))), c.close()) }), { headers: { 'content-type': 'text/event-stream' } })

afterEach(() => vi.unstubAllGlobals())

describe('the OpenAI adapter', () => {
  it('sends the key as a bearer to the fixed endpoint, the system message first, and maps usage and finish', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(reply(200, { model: 'gpt-5-2026', choices: [{ message: { content: 'Hello' }, finish_reason: 'length' }], usage: { prompt_tokens: 7, completion_tokens: 3 } })))
    vi.stubGlobal('fetch', fetchMock)
    const answer = await openaiChat(key).generateResponse({ ...request, temperature: 0.5 })
    expect(answer).toEqual({ text: 'Hello', model: 'gpt-5-2026', finish: 'length', usage: { tokensIn: 7, tokensOut: 3 } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${key}`)
    const body = JSON.parse(String(init.body)) as { messages: { role: string }[]; max_completion_tokens: number; temperature: number }
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(body).toMatchObject({ max_completion_tokens: 50, temperature: 0.5 })
  })

  it('preserves a native system block array and existing system messages through chat completions', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(reply(200, { model: 'gpt-5', choices: [] })))
    vi.stubGlobal('fetch', fetchMock)
    await openaiChat(key).generateResponse({ ...request, system: [{ type: 'text', text: 'Native system' }], messages: [{ role: 'system', content: 'Existing system' }, { role: 'user', content: 'Hi' }] })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ messages: [
      { role: 'system', content: [{ type: 'text', text: 'Native system' }] },
      { role: 'system', content: 'Existing system' },
      { role: 'user', content: 'Hi' },
    ] })
  })

  it('sends a system block array and a system turn as system messages, in order', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(reply(200, { model: 'gpt-5', choices: [] })))
    vi.stubGlobal('fetch', fetchMock)
    await openaiChat(key).generateResponse({ ...request, system: [{ type: 'text', text: 'Block' }], messages: [{ role: 'system', content: 'Turn' }, { role: 'user', content: 'Hi' }] })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).messages).toEqual([{ role: 'system', content: [{ type: 'text', text: 'Block' }] }, { role: 'system', content: 'Turn' }, { role: 'user', content: 'Hi' }])
  })

  it('sends no system message for an empty system string', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(reply(200, { model: 'gpt-5', choices: [] })))
    vi.stubGlobal('fetch', fetchMock)
    await openaiChat(key).generateResponse({ ...request, system: '', messages: [{ role: 'user', content: 'Hi' }] })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).messages).toEqual([{ role: 'user', content: 'Hi' }])
  })

  it('passes only the provider options it takes and refuses the rest, so no header or host rides along', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(reply(200, { model: 'm', choices: [] }))))
    await expect(openaiChat(key).generateResponse({ ...request, options: { top_p: 0.9, base_url: 'https://evil.example' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(openaiChat(key).generateResponse({ ...request, options: { top_p: 0.9, seed: 1 } })).resolves.toMatchObject({ text: '' })
  })

  it.each([
    [401, 'INVALID_CREDENTIALS'],
    [403, 'INVALID_CREDENTIALS'],
    [404, 'MODEL_NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [400, 'BAD_REQUEST'],
    [500, 'PROVIDER_UNAVAILABLE'],
  ])('answers a %s as %s, carrying nothing the provider said', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(reply(status, { error: { message: `bad key ${key} for org acme` } }, { 'retry-after': '3' }))))
    const error = await openaiChat(key).generateResponse(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GatewayError)
    expect((error as GatewayError).code).toBe(code)
    expect(JSON.stringify(error)).not.toContain(key)
    expect(String((error as GatewayError).message)).not.toContain('acme')
    if (status === 429) expect((error as GatewayError).retryAfter).toBe(3)
  })

  it('answers a network failure as unavailable, a deadline as a timeout and a caller who left as cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('socket'))))
    await expect(openaiChat(key).generateResponse(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    const gone = new AbortController()
    gone.abort()
    await expect(openaiChat(key).generateResponse(request, gone.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('reads a stream into text chunks then one end with usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sse([
            'data: {"model":"gpt-5","choices":[{"delta":{"content":"He"}}]}',
            'data: {"model":"gpt-5","choices":[{"delta":{"content":"llo"},"finish_reason":"stop"}]}',
            'data: {"model":"gpt-5","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2}}',
            'data: [DONE]',
            '',
          ]),
        ),
      ),
    )
    const chunks = []
    for await (const c of openaiChat(key).streamResponse(request)) chunks.push(c)
    expect(chunks).toEqual([
      { kind: 'text', text: 'He' },
      { kind: 'text', text: 'llo' },
      { kind: 'end', finish: 'stop', model: 'gpt-5', usage: { tokensIn: 4, tokensOut: 2 } },
    ])
  })

  it('tells a live key from a dead one and from an outage', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(reply(200, { data: [{ id: 'gpt-5' }] }))))
    expect(await openaiChat(key).validateCredentials()).toBe('ok')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(reply(401, {}))))
    expect(await openaiChat(key).validateCredentials()).toBe('rejected')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(reply(503, {}))))
    expect(await openaiChat(key).validateCredentials()).toBe('unavailable')
  })
})

describe('retry', () => {
  const sleeps: number[] = []
  const opts = { attempts: 4, baseMs: 100, maxMs: 1000, sleep: (ms: number) => (sleeps.push(ms), Promise.resolve()), random: () => 1 }

  it('backs off exponentially with jitter and succeeds on a later try', async () => {
    sleeps.length = 0
    let n = 0
    const result = await withRetry(() => (++n < 4 ? Promise.reject(new GatewayError('PROVIDER_UNAVAILABLE')) : Promise.resolve('ok')), opts)
    expect(result).toBe('ok')
    expect(sleeps).toEqual([100, 200, 400])
  })

  it('honours the provider\'s retry-after, capped at the maximum', async () => {
    sleeps.length = 0
    let n = 0
    await withRetry(() => (++n < 3 ? Promise.reject(new GatewayError('RATE_LIMITED', 5)) : Promise.resolve(1)), opts)
    expect(sleeps).toEqual([1000, 1000])
  })

  it.each(['INVALID_CREDENTIALS', 'BAD_REQUEST', 'MODEL_NOT_FOUND', 'CANCELLED', 'CONTENT_REFUSED'] as const)('never retries %s', async (code) => {
    let n = 0
    await expect(withRetry(() => (++n, Promise.reject(new GatewayError(code))), opts)).rejects.toMatchObject({ code })
    expect(n).toBe(1)
    expect(transientCodes.has(code)).toBe(false)
  })

  it('stops at the last attempt with the last error', async () => {
    let n = 0
    await expect(withRetry(() => (++n, Promise.reject(new GatewayError('TIMEOUT'))), { ...opts, attempts: 2 })).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(n).toBe(2)
  })
})

describe('the model registry', () => {
  it('knows only its own models, per provider, and prices each separately', () => {
    expect(capabilityOf('anthropic', 'gpt-5')).toBeNull()
    expect(capabilityOf('openai', 'gpt-5')?.provider).toBe('openai')
    expect(modelsOf('anthropic').every((m) => m.startsWith('claude-'))).toBe(true)
    const a = capabilityOf('anthropic', 'claude-sonnet-5-5')
    const o = capabilityOf('openai', 'gpt-5')
    expect(a && o && costOf(a, 1_000_000, 1_000_000)).not.toBe(a && o && costOf(o, 1_000_000, 1_000_000))
  })
})
