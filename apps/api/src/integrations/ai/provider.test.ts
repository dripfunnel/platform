import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ options: vi.fn(), stream: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: mocks.stream }

    constructor(options: unknown) {
      mocks.options(options)
    }
  },
}))

import { anthropicOAuthDesignerProvider } from './provider'

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

  expect(mocks.options).toHaveBeenCalledWith({ apiKey: null, authToken: 'oauth-token', defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' }, timeout: 180_000 })
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
