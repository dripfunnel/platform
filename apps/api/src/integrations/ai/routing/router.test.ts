import { describe, expect, it, vi } from 'vitest'
import { UnsupportedFeature, type CanonicalRequest } from '../canonical'
import type { Executor } from '../executors/types'
import { GatewayError, type GatewayErrorCode } from '../gateway'
import { anthropicMessagesRequest, anthropicMessagesResponse, anthropicMessagesStream } from '../translators/anthropic-messages'
import { collectStream, createRouter } from './router'
import type { CooldownStore, Route } from './types'

const request: CanonicalRequest = { model: 'claude-opus-5-5', maxTokens: 100, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }
const message = (text = 'ok') => ({ type: 'message', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } })
const sseEvents = (text: string) => [
  { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 3 } } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
  { type: 'message_stop' },
]

type Script = (GatewayError | unknown)[]
const fake = (id: string, script: Script, streamScript: (() => AsyncGenerator<unknown>)[] = []) => {
  const calls = { execute: 0, stream: 0, models: [] as string[] }
  const executor: Executor = {
    id,
    format: 'anthropic-messages',
    capabilities: { images: true, tools: true, reasoning: true, structuredOutput: false, developerRole: false, streaming: true, maxOutputTokens: 64_000 },
    execute: async (prepared) => {
      calls.execute++
      calls.models.push((prepared.body as { model: string }).model)
      const next = script.shift()
      if (next instanceof Error) throw next
      return next ?? message()
    },
    stream: (() => {
      calls.stream++
      const next = streamScript.shift()
      if (!next) return (async function* () { yield* sseEvents('hi') })()
      return next()
    }) as Executor['stream'],
    validate: async () => 'ok',
  }
  const route = (model = 'claude-opus-5-5', connectionId = id): Route => ({
    provider: 'anthropic',
    model,
    connection: { connectionId, provider: 'anthropic', authType: 'api_key', secret: `secret-${id}` },
    executor,
    requestTranslator: anthropicMessagesRequest as Route['requestTranslator'],
    responseTranslator: anthropicMessagesResponse,
    streamTranslator: anthropicMessagesStream,
  })
  return { route, calls }
}

const retry = { attempts: 3, baseMs: 100, maxMs: 1000 }
const sleeps: number[] = []
const deps = { sleep: (ms: number) => (sleeps.push(ms), Promise.resolve()), random: () => 1 }
const events = async (iterable: AsyncIterable<unknown>) => {
  const out: { kind: string }[] = []
  for await (const e of iterable) out.push(e as { kind: string })
  return out
}
const store = (cooling: readonly string[] = []) => {
  const started: [string, number | null, string | undefined][] = []
  const cooldown: CooldownStore = { isCoolingDown: async (id, model) => cooling.includes(model ? `${id}/${model}` : id) || cooling.includes(id), startCooldown: async (id, seconds, model) => void started.push([id, seconds, model]) }
  return { cooldown, started }
}

describe('routing choice', () => {
  it('uses the primary route, its model and its credential, and signals no fallback', async () => {
    const a = fake('a', [])
    const b = fake('b', [])
    const router = createRouter({ primary: a.route('claude-haiku-4-5'), fallbacks: [b.route()], retry }, deps)
    const routed = await router.complete(request)
    expect(routed).toMatchObject({ fallbackUsed: false, fallbackFrom: null, value: { text: 'ok', usage: { tokensIn: 3, tokensOut: 2 } } })
    expect(a.calls.models).toEqual(['claude-haiku-4-5'])
    expect(b.calls.execute).toBe(0)
  })

  it('streams through the stream translator to canonical events', async () => {
    const a = fake('a', [])
    const routed = await createRouter({ primary: a.route(), fallbacks: [], retry }, deps).stream(request)
    expect((await events(routed.value)).map((e) => e.kind)).toEqual(['text', 'usage', 'end'])
  })
})

describe('fallback', () => {
  it.each(['RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT'] as const)('moves to an authorized route after %s, once the retries are spent (a 429 is not retried), and says so', async (code) => {
    const a = fake('a', [new GatewayError(code), new GatewayError(code), new GatewayError(code)])
    const b = fake('b', [])
    const routed = await createRouter({ primary: a.route(), fallbacks: [b.route('claude-sonnet-5-5')], retry }, deps).complete(request)
    expect(a.calls.execute).toBe(code === 'RATE_LIMITED' ? 1 : 3)
    expect(routed).toMatchObject({ fallbackUsed: true, fallbackFrom: code, route: { connection: { connectionId: 'b' } } })
    expect(b.calls.models).toEqual(['claude-sonnet-5-5'])
  })

  it('has no fallback unless one is passed in: the failure reaches the caller', async () => {
    const a = fake('a', [new GatewayError('PROVIDER_UNAVAILABLE'), new GatewayError('PROVIDER_UNAVAILABLE'), new GatewayError('PROVIDER_UNAVAILABLE')])
    await expect(createRouter({ primary: a.route(), fallbacks: [], retry }, deps).complete(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it.each(['INVALID_CREDENTIALS', 'BAD_REQUEST', 'CONTENT_REFUSED', 'CANCELLED', 'MODEL_NOT_FOUND'] as const)('never falls back, nor retries, on %s', async (code) => {
    const a = fake('a', [new GatewayError(code)])
    const b = fake('b', [])
    await expect(createRouter({ primary: a.route(), fallbacks: [b.route()], retry }, deps).complete(request)).rejects.toMatchObject({ code })
    expect(a.calls.execute).toBe(1)
    expect(b.calls.execute).toBe(0)
  })

  it('does not fall back to a route that cannot carry the request, and tells the caller what the primary said', async () => {
    const a = fake('a', [new GatewayError('TIMEOUT'), new GatewayError('TIMEOUT'), new GatewayError('TIMEOUT')])
    const b = fake('b', [])
    const noImages = b.route()
    noImages.executor = { ...noImages.executor, capabilities: { ...noImages.executor.capabilities, images: false } }
    const withImage: CanonicalRequest = { ...request, messages: [{ role: 'user', content: [{ type: 'image', mediaType: 'image/png', base64: 'aGk=' }] }] }
    await expect(createRouter({ primary: a.route(), fallbacks: [noImages], retry }, deps).complete(withImage)).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(b.calls.execute).toBe(0)
  })

  it('refuses a request the primary cannot carry, with UnsupportedFeature, instead of dropping it', async () => {
    const a = fake('a', [])
    const route = a.route()
    route.executor = { ...route.executor, capabilities: { ...route.executor.capabilities, images: false } }
    const withImage: CanonicalRequest = { ...request, messages: [{ role: 'user', content: [{ type: 'image', mediaType: 'image/png', base64: 'aGk=' }] }] }
    await expect(createRouter({ primary: route, fallbacks: [], retry }, deps).complete(withImage)).rejects.toBeInstanceOf(UnsupportedFeature)
  })
})

describe('retries and Retry-After', () => {
  it('retries a transient failure in one loop and succeeds', async () => {
    sleeps.length = 0
    const a = fake('a', [new GatewayError('PROVIDER_UNAVAILABLE'), new GatewayError('TIMEOUT')])
    const routed = await createRouter({ primary: a.route(), fallbacks: [], retry }, deps).complete(request)
    expect(a.calls.execute).toBe(3)
    expect(routed.value.text).toBe('ok')
    expect(sleeps).toEqual([100, 200])
  })

  it('waits at least the provider’s Retry-After, within the cap', async () => {
    sleeps.length = 0
    const a = fake('a', [new GatewayError('PROVIDER_UNAVAILABLE', 1)])
    await createRouter({ primary: a.route(), fallbacks: [], retry }, deps).complete(request)
    expect(sleeps).toEqual([1000])
  })

  it('stops at the attempt limit with the last error', async () => {
    const a = fake('a', Array.from({ length: 5 }, () => new GatewayError('PROVIDER_UNAVAILABLE')))
    await expect(createRouter({ primary: a.route(), fallbacks: [], retry: { ...retry, attempts: 2 } }, deps).complete(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(a.calls.execute).toBe(2)
  })
})

describe('cooldown', () => {
  it('skips a cooling connection without calling it, and uses the authorized fallback', async () => {
    const { cooldown } = store(['a'])
    const a = fake('a', [])
    const b = fake('b', [])
    const routed = await createRouter({ primary: a.route(), fallbacks: [b.route()], retry }, { ...deps, cooldown }).complete(request)
    expect(a.calls.execute).toBe(0)
    expect(routed).toMatchObject({ fallbackUsed: true, fallbackFrom: 'RATE_LIMITED' })
  })

  it('with every route cooling, answers RATE_LIMITED without a provider call', async () => {
    const { cooldown } = store(['a'])
    const a = fake('a', [])
    await expect(createRouter({ primary: a.route(), fallbacks: [], retry }, { ...deps, cooldown }).complete(request)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(a.calls.execute).toBe(0)
  })

  it('holds only the model that was limited: another model on the same connection still runs', async () => {
    const { cooldown } = store(['a/claude-sonnet-5-5'])
    const a = fake('a', [])
    await expect(createRouter({ primary: a.route('claude-sonnet-5-5'), fallbacks: [], retry }, { ...deps, cooldown }).complete(request)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(a.calls.execute).toBe(0)
    const routed = await createRouter({ primary: a.route('claude-haiku-4-5'), fallbacks: [], retry }, { ...deps, cooldown }).complete(request)
    expect(routed.value.text).toBe('ok')
    expect(a.calls.models).toEqual(['claude-haiku-4-5'])
  })

  it('starts a cooldown with the provider’s Retry-After on the first 429, which is not sent again, and for no other code', async () => {
    const limited = store()
    sleeps.length = 0
    const a = fake('a', [new GatewayError('RATE_LIMITED', 600), new GatewayError('RATE_LIMITED', 600), new GatewayError('RATE_LIMITED', 600)])
    await expect(createRouter({ primary: a.route(), fallbacks: [], retry }, { ...deps, cooldown: limited.cooldown }).complete(request)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(a.calls.execute).toBe(1)
    expect(sleeps).toEqual([])
    expect(limited.started).toEqual([['a', 600, 'claude-opus-5-5']])
    const down = store()
    const b = fake('b', [new GatewayError('PROVIDER_UNAVAILABLE'), new GatewayError('PROVIDER_UNAVAILABLE'), new GatewayError('PROVIDER_UNAVAILABLE')])
    await expect(createRouter({ primary: b.route(), fallbacks: [], retry }, { ...deps, cooldown: down.cooldown }).complete(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(down.started).toEqual([])
  })
})

describe('cancellation', () => {
  it('cancels before any call when the caller already left, and never retries a cancelled call', async () => {
    const a = fake('a', [])
    const controller = new AbortController()
    controller.abort()
    await expect(createRouter({ primary: a.route(), fallbacks: [], retry }, deps).complete(request, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(a.calls.execute).toBe(0)
  })

  it('does not wait out a backoff once the caller leaves', async () => {
    const controller = new AbortController()
    const a = fake('a', [new GatewayError('PROVIDER_UNAVAILABLE')])
    const sleep = vi.fn().mockImplementation(() => (controller.abort(), Promise.reject(new GatewayError('CANCELLED'))))
    await expect(createRouter({ primary: a.route(), fallbacks: [fake('b', []).route()], retry }, { sleep }).complete(request, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(a.calls.execute).toBe(1)
  })
})

describe('streams', () => {
  const failing = (code: GatewayErrorCode) => async function* () {
    yield* []
    throw new GatewayError(code)
  }

  it('retries and falls back on a failure before the first byte', async () => {
    const a = fake('a', [], [failing('PROVIDER_UNAVAILABLE'), failing('PROVIDER_UNAVAILABLE'), failing('PROVIDER_UNAVAILABLE')])
    const b = fake('b', [])
    const routed = await createRouter({ primary: a.route(), fallbacks: [b.route()], retry }, deps).stream(request)
    expect(routed.fallbackUsed).toBe(true)
    expect((await events(routed.value)).map((e) => e.kind)).toEqual(['text', 'usage', 'end'])
    expect(a.calls.stream).toBe(3)
  })

  it('surfaces a failure after the first byte as an error event: no retry, no fallback, never an end', async () => {
    const cut = async function* () {
      yield sseEvents('hi')[0]
      yield sseEvents('hi')[1]
      throw new GatewayError('PROVIDER_UNAVAILABLE')
    }
    const a = fake('a', [], [cut])
    const b = fake('b', [])
    const routed = await createRouter({ primary: a.route(), fallbacks: [b.route()], retry }, deps).stream(request)
    const seen = await events(routed.value)
    expect(seen.map((e) => e.kind)).toEqual(['text', 'error'])
    expect(a.calls.stream).toBe(1)
    expect(b.calls.stream).toBe(0)
    await expect(collectStream((async function* () { yield* seen as never[] })())).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('treats a stream that ends with no terminal event as an error, not success', async () => {
    const short = async function* () {
      yield sseEvents('hi')[0]
      yield sseEvents('hi')[1]
    }
    const routed = await createRouter({ primary: fake('a', [], [short]).route(), fallbacks: [], retry }, deps).stream(request)
    const seen = await events(routed.value)
    expect(seen.at(-1)).toMatchObject({ kind: 'error', code: 'PROVIDER_UNAVAILABLE' })
    expect(seen.some((e) => e.kind === 'end')).toBe(false)
  })

  it('starts a cooldown when a stream is rate limited mid-way', async () => {
    const limited = store()
    const mid = async function* () {
      yield sseEvents('hi')[1]
      throw new GatewayError('RATE_LIMITED', 12)
    }
    const routed = await createRouter({ primary: fake('a', [], [mid]).route(), fallbacks: [], retry }, { ...deps, cooldown: limited.cooldown }).stream(request)
    await events(routed.value)
    expect(limited.started).toEqual([['a', 12, 'claude-opus-5-5']])
  })
})
