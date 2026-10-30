import { describe, expect, it, vi } from 'vitest'
import { GatewayError } from '../gateway'
import { providerHeaders } from '../headers'
import { anthropicExecutor } from './anthropic'
import { openaiExecutor } from './openai'
import { openaiResponsesExecutor } from './openai-responses'
import { executorFor, NoExecutorError } from './registry'
import type { ResolvedConnection } from './types'

const key = (provider: ResolvedConnection['provider'] = 'anthropic'): ResolvedConnection => ({ connectionId: 'c1', provider, authType: 'api_key', secret: 'sk-secret-1' })
const oauth: ResolvedConnection = { connectionId: 'c2', provider: 'anthropic', authType: 'oauth', secret: 'old-token' }
const prepared = { body: { model: 'm', prompt: 'private prompt' }, stream: false }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers })
const sse = (...chunks: string[]) => new Response(new ReadableStream({ start: (c) => (chunks.forEach((x) => c.enqueue(new TextEncoder().encode(x))), c.close()) }), { headers: { 'content-type': 'text/event-stream' } })
const collect = async (iterable: AsyncIterable<unknown>) => {
  const out: unknown[] = []
  for await (const item of iterable) out.push(item)
  return out
}
const headersOf = (send: ReturnType<typeof vi.fn>, call = 0) => (send.mock.calls[call]?.[1] as RequestInit).headers as Record<string, string>
const failure = (work: Promise<unknown>) => work.then(() => null, (error: unknown) => error as GatewayError)

describe('auth and URLs', () => {
  it('sends an Anthropic key as x-api-key to the fixed host, with no redirects', async () => {
    const send = vi.fn().mockResolvedValue(json({ ok: 1 }))
    expect(await anthropicExecutor({ fetch: send }).execute(prepared, key())).toEqual({ ok: 1 })
    expect(send.mock.calls[0]?.[0]).toBe('https://api.anthropic.com/v1/messages')
    expect(send.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'manual', body: JSON.stringify(prepared.body) })
    expect(headersOf(send)).toMatchObject({ 'x-api-key': 'sk-secret-1', 'anthropic-version': '2023-06-01' })
    expect(headersOf(send)).not.toHaveProperty('authorization')
    expect(headersOf(send)).toEqual(providerHeaders({ provider: 'anthropic', auth: 'api_key', secret: 'sk-secret-1', stream: false, hasBody: true }))
  })

  it('refuses a redirect instead of following it with the credential', async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }))
    await expect(anthropicExecutor({ fetch: send }).execute({ body: {}, stream: false }, { connectionId: 'c', provider: 'anthropic', authType: 'api_key', secret: 'sk-secret' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('sends a Claude sign-in as a bearer with the OAuth beta', async () => {
    const send = vi.fn().mockResolvedValue(json({}))
    await anthropicExecutor({ fetch: send }).execute(prepared, oauth)
    expect(headersOf(send)).toMatchObject({ authorization: 'Bearer old-token', 'anthropic-beta': 'oauth-2025-04-20' })
    expect(headersOf(send)).not.toHaveProperty('x-api-key')
    expect(headersOf(send)).toEqual(providerHeaders({ provider: 'anthropic', auth: 'oauth', secret: 'old-token', stream: false, hasBody: true }))
  })

  it('sends OpenAI keys as a bearer to chat completions and to responses', async () => {
    const send = vi.fn().mockImplementation(async () => json({}))
    await openaiExecutor({ fetch: send }).execute(prepared, key('openai'))
    await openaiResponsesExecutor({ fetch: send }).execute(prepared, key('openai'))
    expect(send.mock.calls.map((c) => c[0])).toEqual(['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/responses'])
    expect(headersOf(send)).toEqual(providerHeaders({ provider: 'openai', auth: 'api_key', secret: 'sk-secret-1', stream: false, hasBody: true }))
    expect(headersOf(send, 1)).toEqual(headersOf(send))
    expect(headersOf(send)).not.toHaveProperty('originator')
  })

  it('refuses a connection of another provider or an unsupported auth type, without sending', async () => {
    const send = vi.fn()
    expect((await failure(openaiExecutor({ fetch: send }).execute(prepared, key('anthropic'))))?.code).toBe('BAD_REQUEST')
    expect((await failure(openaiExecutor({ fetch: send }).execute(prepared, { ...key('openai'), authType: 'oauth' })))?.code).toBe('BAD_REQUEST')
    expect(send).not.toHaveBeenCalled()
  })

  it('validates with a models list: ok, rejected on 401, unavailable on 500', async () => {
    const send = vi.fn().mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({}, 500))
    const executor = anthropicExecutor({ fetch: send })
    expect([await executor.validate(key()), await executor.validate(key()), await executor.validate(key())]).toEqual(['ok', 'rejected', 'unavailable'])
    expect(send.mock.calls[0]?.[0]).toBe('https://api.anthropic.com/v1/models?limit=1')
    expect(send.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' })
  })
})

describe('credential refresh', () => {
  it('refreshes once on a 401 and retries once with the new secret', async () => {
    const send = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ ok: 1 }))
    const refresh = vi.fn().mockResolvedValue({ secret: 'new-token' })
    expect(await anthropicExecutor({ fetch: send, refresh }).execute(prepared, oauth)).toEqual({ ok: 1 })
    expect(refresh).toHaveBeenCalledWith('c2')
    expect(headersOf(send, 1)).toMatchObject({ authorization: 'Bearer new-token' })
  })

  it('answers INVALID_CREDENTIALS when the retry is refused too, with one refresh', async () => {
    const send = vi.fn().mockImplementation(async () => json({}, 401))
    const refresh = vi.fn().mockResolvedValue({ secret: 'new-token' })
    expect((await failure(anthropicExecutor({ fetch: send, refresh }).execute(prepared, oauth)))?.code).toBe('INVALID_CREDENTIALS')
    expect(send).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('answers INVALID_CREDENTIALS when the refresh itself fails, and never refreshes an API key', async () => {
    const send = vi.fn().mockImplementation(async () => json({}, 401))
    const refresh = vi.fn().mockRejectedValue(new Error('refresh body with old-token'))
    const error = await failure(anthropicExecutor({ fetch: send, refresh }).execute(prepared, oauth))
    expect(error?.code).toBe('INVALID_CREDENTIALS')
    expect(error?.message).not.toContain('old-token')
    expect((await failure(anthropicExecutor({ fetch: send, refresh }).execute(prepared, key())))?.code).toBe('INVALID_CREDENTIALS')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shares one refresh between concurrent calls on the same connection', async () => {
    const send = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => ((init.headers as Record<string, string>)['authorization'] === 'Bearer old-token' ? json({}, 401) : json({ ok: 1 })))
    let release: (value: { secret: string }) => void = () => undefined
    const refresh = vi.fn().mockReturnValue(new Promise((resolve) => (release = resolve)))
    const executor = anthropicExecutor({ fetch: send, refresh })
    const calls = Promise.all([executor.execute(prepared, oauth), executor.execute(prepared, oauth), executor.execute(prepared, oauth)])
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3))
    release({ secret: 'new-token' })
    expect(await calls).toEqual([{ ok: 1 }, { ok: 1 }, { ok: 1 }])
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('errors', () => {
  const codeOf = async (response: Response) => (await failure(anthropicExecutor({ fetch: vi.fn().mockResolvedValue(response) }).execute(prepared, key())))

  it('maps statuses', async () => {
    const table: [number, string][] = [[401, 'INVALID_CREDENTIALS'], [403, 'INVALID_CREDENTIALS'], [404, 'MODEL_NOT_FOUND'], [400, 'BAD_REQUEST'], [413, 'BAD_REQUEST'], [422, 'BAD_REQUEST'], [408, 'TIMEOUT'], [429, 'RATE_LIMITED'], [500, 'PROVIDER_UNAVAILABLE'], [529, 'PROVIDER_UNAVAILABLE']]
    for (const [status, code] of table) expect((await codeOf(json({}, status)))?.code).toBe(code)
  })

  it('reads Retry-After as seconds and as an HTTP-date', async () => {
    expect((await codeOf(json({}, 429, { 'retry-after': '7' })))?.retryAfter).toBe(7)
    const now = new Date('2026-01-01T00:00:00Z')
    const dated = json({}, 429, { 'retry-after': 'Thu, 01 Jan 2026 00:00:30 GMT' })
    const error = await failure(anthropicExecutor({ fetch: vi.fn().mockResolvedValue(dated), now: () => now }).execute(prepared, key()))
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryAfter: 30 })
    expect((await codeOf(json({}, 429)))?.retryAfter).toBeNull()
  })

  it('maps a network failure, a timeout and a caller abort', async () => {
    const down = anthropicExecutor({ fetch: vi.fn().mockRejectedValue(new TypeError('connect ECONNREFUSED sk-secret-1')) })
    expect((await failure(down.execute(prepared, key())))?.code).toBe('PROVIDER_UNAVAILABLE')
    const hang = (_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))))
    expect((await failure(anthropicExecutor({ fetch: hang, timeoutMs: 10 }).execute(prepared, key())))?.code).toBe('TIMEOUT')
    const controller = new AbortController()
    const pending = failure(anthropicExecutor({ fetch: hang }).execute(prepared, key(), controller.signal))
    controller.abort()
    expect((await pending)?.code).toBe('CANCELLED')
  })

  it('puts no secret, header or upstream body in an error', async () => {
    const hostile = json({ error: { message: 'leaked sk-secret-1 private prompt' } }, 400, { 'x-request-id': 'req-123' })
    const error = await codeOf(hostile)
    expect(JSON.stringify({ message: error?.message, stack: error?.stack?.split('\n')[0], ...error })).not.toMatch(/sk-secret-1|private prompt|req-123/)
  })
})

describe('streaming', () => {
  const event = (type: string, extra: object = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`
  const streaming = { body: {}, stream: true }

  it('yields each Anthropic event and ends cleanly at message_stop, across chunk boundaries', async () => {
    const text = event('message_start') + event('content_block_delta', { delta: { text: 'hi' } }) + event('message_stop')
    const send = vi.fn().mockResolvedValue(sse(text.slice(0, 20), text.slice(20, 70), text.slice(70)))
    const events = await collect(anthropicExecutor({ fetch: send }).stream(streaming, key()))
    expect(events.map((e) => (e as { type: string }).type)).toEqual(['message_start', 'content_block_delta', 'message_stop'])
    expect(headersOf(send)).toMatchObject({ accept: 'text/event-stream' })
  })

  it('yields OpenAI chunks until [DONE] and reads CRLF line ends', async () => {
    const send = vi.fn().mockResolvedValue(sse('data: {"a":1}\r\n\r\ndata: {"a":2}\r\n\r\ndata: [DONE]\r\n\r\n'))
    expect(await collect(openaiExecutor({ fetch: send }).stream(streaming, key('openai')))).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('ends a Responses stream at response.completed', async () => {
    const send = vi.fn().mockResolvedValue(sse(event('response.output_text.delta'), event('response.completed')))
    expect(await collect(openaiResponsesExecutor({ fetch: send }).stream(streaming, key('openai')))).toHaveLength(2)
  })

  it('throws, not ends, when the stream is cut before its terminal event', async () => {
    const send = vi.fn().mockResolvedValue(sse(event('message_start'), event('content_block_delta')))
    const seen: unknown[] = []
    const error = await failure((async () => { for await (const e of anthropicExecutor({ fetch: send }).stream(streaming, key())) seen.push(e) })())
    expect(seen).toHaveLength(2)
    expect(error?.code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('throws on an event cut mid-JSON and on a body that errors mid-stream', async () => {
    const cut = vi.fn().mockResolvedValue(sse(event('message_start'), 'data: {"type":"content_blo'))
    expect((await failure(collect(anthropicExecutor({ fetch: cut }).stream(streaming, key()))))?.code).toBe('PROVIDER_UNAVAILABLE')
    const broken = new Response(new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode(event('message_start'))), c.error(new Error('reset by peer'))) }))
    expect((await failure(collect(anthropicExecutor({ fetch: vi.fn().mockResolvedValue(broken) }).stream(streaming, key()))))?.code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('turns a provider error event inside the stream into a GatewayError', async () => {
    const send = vi.fn().mockResolvedValue(sse(event('message_start'), event('error', { error: { type: 'overloaded_error', message: 'busy sk-secret-1' } })))
    const error = await failure(collect(anthropicExecutor({ fetch: send }).stream(streaming, key())))
    expect(error?.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error?.message).not.toContain('sk-secret-1')
    const limited = vi.fn().mockResolvedValue(sse(event('error', { error: { type: 'rate_limit_error' } })))
    expect((await failure(collect(anthropicExecutor({ fetch: limited }).stream(streaming, key()))))?.code).toBe('RATE_LIMITED')
  })

  it('maps an HTTP failure before the stream starts, with Retry-After', async () => {
    const send = vi.fn().mockResolvedValue(json({}, 429, { 'retry-after': '3' }))
    expect(await failure(collect(anthropicExecutor({ fetch: send }).stream(streaming, key())))).toMatchObject({ code: 'RATE_LIMITED', retryAfter: 3 })
  })

  it('stops with CANCELLED when the caller aborts mid-stream and cancels the body', async () => {
    const controller = new AbortController()
    const cancelled = vi.fn()
    const body = new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode(event('message_start'))), cancel: cancelled })
    const iterator = anthropicExecutor({ fetch: vi.fn().mockResolvedValue(new Response(body)) }).stream(streaming, key(), controller.signal)[Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    const next = failure(iterator.next())
    controller.abort()
    expect((await next)?.code).toBe('CANCELLED')
    expect(cancelled).toHaveBeenCalled()
  })

  it('times out a stream that stalls', async () => {
    const body = new ReadableStream({ start: () => undefined })
    const error = await failure(collect(anthropicExecutor({ fetch: vi.fn().mockResolvedValue(new Response(body)), timeoutMs: 20 }).stream(streaming, key())))
    expect(error?.code).toBe('TIMEOUT')
  })
})

describe('registry', () => {
  it('picks by provider and auth type, and refuses what has no executor', () => {
    expect(executorFor({ provider: 'anthropic', authType: 'oauth' }).id).toBe('anthropic-messages')
    expect(executorFor({ provider: 'openai', authType: 'api_key' }).id).toBe('openai-chat')
    expect(executorFor({ provider: 'openai', authType: 'api_key' }, undefined, 'openai-responses').id).toBe('openai-responses')
    expect(() => executorFor({ provider: 'openai', authType: 'oauth' })).toThrow(NoExecutorError)
    expect(() => executorFor({ provider: 'anthropic', authType: 'api_key' }, undefined, 'openai-chat')).toThrow(NoExecutorError)
  })
})
