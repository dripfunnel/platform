import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn(), options: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.create, stream: mocks.stream }
    models = { list: vi.fn() }
    constructor(options: unknown) { mocks.options(options) }
  },
}))

import { anthropicChat } from './anthropicChat'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.create.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], model: 'claude-sonnet', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
})

it('preserves a native system block array in the Anthropic request', async () => {
  await anthropicChat({ authToken: 'oauth-token' }).generateResponse({
    model: 'claude-sonnet', maxTokens: 100,
    system: [{ type: 'text', text: 'Native system' }],
    messages: [{ role: 'user', content: 'Hi' }],
  })
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ system: [{ type: 'text', text: 'Native system' }], messages: [{ role: 'user', content: 'Hi' }] }), { signal: undefined })
})

it('lifts existing system messages into Anthropic system without dropping them', async () => {
  await anthropicChat({ authToken: 'oauth-token' }).generateResponse({
    model: 'claude-sonnet', maxTokens: 100,
    messages: [{ role: 'system', content: 'Existing system' }, { role: 'user', content: 'Hi' }],
  })
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ system: [{ type: 'text', text: 'Existing system' }], messages: [{ role: 'user', content: 'Hi' }] }), { signal: undefined })
})
