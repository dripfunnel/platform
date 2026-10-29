import { anthropicMessagesRequest, anthropicMessagesResponse, anthropicMessagesStream } from './anthropic-messages'
import { openaiChatRequest, openaiChatResponse, openaiChatStream } from './openai-chat'
import { openaiResponsesRequest, openaiResponsesResponse, openaiResponsesStream } from './openai-responses'
import type { FormatId, RequestTranslator, ResponseTranslator, StreamTranslatorFactory, TranslatorRegistry } from './types'

export const createTranslatorRegistry = (): TranslatorRegistry => ({ request: {}, response: {}, stream: {} })

/** One format at a time, so a format can be registered without the others. */
export const registerTranslators = (registry: TranslatorRegistry, format: FormatId, translators: { request: RequestTranslator<unknown>; response: ResponseTranslator<unknown>; stream: StreamTranslatorFactory<unknown> }): void => {
  registry.request[format] = translators.request
  registry.response[format] = translators.response
  registry.stream[format] = translators.stream
}

export const defaultTranslators = (): TranslatorRegistry => {
  const registry = createTranslatorRegistry()
  registerTranslators(registry, 'anthropic-messages', { request: anthropicMessagesRequest, response: anthropicMessagesResponse, stream: anthropicMessagesStream })
  registerTranslators(registry, 'openai-chat', { request: openaiChatRequest, response: openaiChatResponse, stream: openaiChatStream })
  registerTranslators(registry, 'openai-responses', { request: openaiResponsesRequest, response: openaiResponsesResponse, stream: openaiResponsesStream })
  return registry
}

/** A format nobody registered is a wiring fault, not a request the caller can fix. */
export const translatorsFor = (registry: TranslatorRegistry, format: FormatId) => {
  const request = registry.request[format]
  const response = registry.response[format]
  const stream = registry.stream[format]
  if (!request || !response || !stream) throw new Error(`no translators registered for ${format}`)
  return { request, response, stream }
}
