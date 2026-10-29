import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent, ProviderCapabilities } from '../canonical'

export const formatIds = ['anthropic-messages', 'openai-chat', 'openai-responses'] as const
export type FormatId = (typeof formatIds)[number]

export interface RequestTranslator<TBody> {
  readonly id: string
  readonly from: 'canonical'
  readonly to: FormatId
  /** Throws UnsupportedFeature for anything `capabilities` or the format cannot carry; never drops it silently. */
  translate: (request: CanonicalRequest, capabilities: ProviderCapabilities) => TBody
}

export interface ResponseTranslator<TRaw> {
  readonly from: FormatId
  parse: (raw: TRaw) => CanonicalResponse
}

/** One per stream: holds the partial state between events. */
export interface StreamTranslator<TEvent> {
  feed: (event: TEvent) => CanonicalStreamEvent[]
  /** Called when the source ends; a stream that never reached its terminal event must yield an `error` event, not look like success. */
  finish: () => CanonicalStreamEvent[]
}

export interface StreamTranslatorFactory<TEvent> {
  readonly from: FormatId
  create: () => StreamTranslator<TEvent>
}

/** The translators of each format, keyed by its id. */
export interface TranslatorRegistry {
  request: Partial<{ [F in FormatId]: RequestTranslator<unknown> }>
  response: Partial<{ [F in FormatId]: ResponseTranslator<unknown> }>
  stream: Partial<{ [F in FormatId]: StreamTranslatorFactory<unknown> }>
}
