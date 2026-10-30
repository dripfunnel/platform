import { describe, expect, it } from 'vitest'
import { createTranslatorRegistry, defaultTranslators, registerTranslators, translatorsFor } from './registry'
import { openaiChatRequest, openaiChatResponse, openaiChatStream } from './openai-chat'
import { formatIds } from './types'

describe('translator registry', () => {
  it('registers all three formats, each keyed by its own id', () => {
    const registry = defaultTranslators()
    for (const format of formatIds) {
      const { request, response, stream } = translatorsFor(registry, format)
      expect([request.to, response.from, stream.from]).toEqual([format, format, format])
    }
  })
  it('registers one format without the others, and refuses a missing one', () => {
    const registry = createTranslatorRegistry()
    registerTranslators(registry, 'openai-chat', { request: openaiChatRequest as never, response: openaiChatResponse, stream: openaiChatStream })
    expect(translatorsFor(registry, 'openai-chat').request.to).toBe('openai-chat')
    expect(() => translatorsFor(registry, 'anthropic-messages')).toThrow('no translators registered')
  })
})
