import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ options: vi.fn(), stream: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    constructor(readonly status: number) {
      super('api error')
    }
    headers = new Headers()
  }
  const Anthropic = class {
    static APIError = APIError
    static APIUserAbortError = class extends Error {}
    static APIConnectionTimeoutError = class extends Error {}
    static APIConnectionError = class extends Error {}
    messages = { stream: mocks.stream }

    constructor(options: unknown) {
      mocks.options(options)
    }
  }
  return { default: Anthropic }
})

import { AiDeclined, anthropicOAuthDesignerProvider, localAiProvider, routedDesignerProvider } from './provider'
import type { CanonicalRequest } from './canonical'
import type { Router } from './routing/router'
import Anthropic from '@anthropic-ai/sdk'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.stream.mockReturnValue({
    finalMessage: async () => ({
      content: [{ type: 'text', text: 'A design response' }],
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 34 },
    }),
  })
})

it('uses the reference OAuth auth, model and streaming Messages request at the maximum output of the model', async () => {
  const answer = await anthropicOAuthDesignerProvider('oauth-token').complete({ system: 'Design a shop', text: 'Warm colours', images: [] })

  expect(mocks.options).toHaveBeenCalledWith({ apiKey: null, authToken: 'oauth-token', defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' }, timeout: 180_000, maxRetries: 0 })
  expect(mocks.stream).toHaveBeenCalledWith({
    model: 'claude-haiku-4-5',
    max_tokens: 64_000,
    system: 'Design a shop',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Warm colours' }] }],
  })
  expect(answer).toEqual({ text: 'A design response', model: 'claude-haiku-4-5', tokensIn: 12, tokensOut: 34, costAmount: 0, costCurrency: 'USD', tokensCached: 0 })
})

it('marks the system and each context part for the cache, before the images and the request (#1238)', async () => {
  await anthropicOAuthDesignerProvider('oauth-token').complete({ system: 'rules', context: ['shop', 'theme'], text: 'ask', images: [{ mediaType: 'image/png', base64: 'aW1hZ2U=' }] })
  const marker = { cache_control: { type: 'ephemeral' } }
  expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({
    system: [{ type: 'text', text: 'rules', ...marker }],
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'shop', ...marker },
      { type: 'text', text: 'theme', ...marker },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
      { type: 'text', text: 'ask' },
    ] }],
  }))
})

it('costs a routed answer’s cached tokens at the cached price and reports them (#1238)', async () => {
  const seen: CanonicalRequest[] = []
  const usage = { tokensIn: 50_000, tokensOut: 100, cachedTokensIn: 40_000, cacheWriteTokensIn: 0 }
  async function* events() {
    yield { kind: 'text' as const, text: '{}' }
    yield { kind: 'usage' as const, usage }
    yield { kind: 'end' as const, finish: 'stop' as const, model: 'claude-opus-5-5' }
  }
  const route = { provider: 'anthropic', model: 'claude-opus-5-5', connection: { authType: 'api_key' } }
  const router = { stream: async (request: CanonicalRequest) => (seen.push(request), { value: events(), route, fallbackUsed: false, fallbackFrom: null }) } as unknown as Router
  const answer = await routedDesignerProvider(router, 'claude-opus-5-5', { signIn: false }).complete({ system: 'rules', context: ['theme'], text: 'ask', images: [] })
  expect(seen[0]).toMatchObject({ cacheSystem: true, messages: [{ role: 'user', content: [{ type: 'text', text: 'theme', cache: true }, { type: 'text', text: 'ask' }] }] })
  expect(answer.tokensCached).toBe(40_000)
  expect(answer.costAmount).toBe(Math.ceil((10_000 * 400 + 40_000 * 20 + 100 * 2000) / 1_000_000))
})

it('sends reference images through the standard Messages content format', async () => {
  await anthropicOAuthDesignerProvider('oauth-token', 'claude-sonnet-5-5').complete({
    system: 'Design a shop',
    text: 'Use this image',
    images: [{ mediaType: 'image/png', base64: 'aW1hZ2U=' }],
  })
  expect(mocks.stream).toHaveBeenCalledWith({
    model: 'claude-sonnet-5-5',
    max_tokens: 64_000,
    system: 'Design a shop',
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
      { type: 'text', text: 'Use this image' },
    ] }],
  })
})

it('counts cached input tokens in tokensIn, as the API-key provider does', async () => {
  mocks.stream.mockReturnValue({ finalMessage: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'claude-haiku-4-5', stop_reason: 'end_turn', usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 3 } }) })
  const answer = await anthropicOAuthDesignerProvider('oauth-token').complete({ system: 's', text: 't', images: [] })
  expect(answer.tokensIn).toBe(35)
})

it('declines when the model refuses', async () => {
  mocks.stream.mockReturnValue({ finalMessage: async () => ({ content: [], model: 'claude-haiku-4-5', stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 } }) })
  await expect(anthropicOAuthDesignerProvider('oauth-token').complete({ system: 's', text: 't', images: [] })).rejects.toBeInstanceOf(AiDeclined)
})

it('maps an Anthropic 429 to RATE_LIMITED and a 401 to INVALID_CREDENTIALS, without the provider body', async () => {
  for (const [status, code] of [[429, 'RATE_LIMITED'], [401, 'INVALID_CREDENTIALS']] as const) {
    mocks.stream.mockReturnValue({ finalMessage: async () => { throw new Anthropic.APIError(status, undefined, 'secret body', undefined) } })
    await expect(anthropicOAuthDesignerProvider('oauth-token').complete({ system: 's', text: 't', images: [] })).rejects.toMatchObject({ code, message: expect.not.stringContaining('secret') })
  }
})

it('sends no tool choice when a turn has no tools, which the translators refuse', async () => {
  const seen: CanonicalRequest[] = []
  const router = { stream: async (request: CanonicalRequest) => (seen.push(request), Promise.reject(new Error('stop here'))) } as unknown as Router
  const provider = routedDesignerProvider(router, 'claude-haiku-4-5', { signIn: false })
  const tool = { name: 'search_stock_images', description: 'x', parameters: { type: 'object' } }
  await provider.converse?.({ system: 's', messages: [], tools: [tool] }).catch(() => undefined)
  await provider.converse?.({ system: 's', messages: [], tools: [] }).catch(() => undefined)
  expect(seen[0]?.toolChoice).toBe('auto')
  expect(seen[1]?.tools).toEqual([])
  expect(seen[1]?.toolChoice).toBeUndefined()
})

it('streams only the local stand-in’s reply, never its JSON envelope (#1237)', async () => {
  const pieces: string[] = []
  const answer = await localAiProvider().complete({ system: '', text: '', images: [], onText: (t) => void pieces.push(t) })
  expect(pieces.join('')).toBe((JSON.parse(answer.text) as { reply: string }).reply)
})
