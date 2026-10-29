import type { CanonicalRequest, CanonicalStreamEvent, ProviderCapabilities } from '../canonical'
import type { StreamTranslatorFactory } from './types'

export const caps: ProviderCapabilities = { images: true, tools: true, reasoning: true, structuredOutput: true, developerRole: true, streaming: true, maxOutputTokens: 8192 }
export const bare: ProviderCapabilities = { images: false, tools: false, reasoning: false, structuredOutput: false, developerRole: false, streaming: true, maxOutputTokens: 8192 }

export const base: CanonicalRequest = { model: 'm', maxTokens: 100, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }

export const png = { type: 'image', mediaType: 'image/png', base64: 'aGVsbG8=' } as const

export const withTools: CanonicalRequest = {
  ...base,
  tools: [{ name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'checking' }, { type: 'tool_call', id: 'c1', name: 'get_weather', arguments: '{"city":"Pune"}' }] },
    { role: 'tool', content: [{ type: 'tool_result', callId: 'c1', content: '31C' }] },
  ],
}

/** Feeds events, then finish(), and returns every canonical event in order. */
export const run = (factory: StreamTranslatorFactory<unknown>, events: readonly unknown[], finish = true): CanonicalStreamEvent[] => {
  const stream = factory.create()
  const out = events.flatMap((event) => stream.feed(event))
  return finish ? [...out, ...stream.finish()] : out
}
