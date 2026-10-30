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

import { AiDeclined, anthropicOAuthDesignerProvider } from './provider'
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
  expect(answer).toEqual({ text: 'A design response', model: 'claude-haiku-4-5', tokensIn: 12, tokensOut: 34, costAmount: 0, costCurrency: 'USD' })
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
