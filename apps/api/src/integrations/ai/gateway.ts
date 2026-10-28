// The provider-independent shape of a chat call (docs/api/SAAS.md §9.3, #950). Each adapter turns it into its provider's
// own request; nothing here pretends two providers are the same, so provider-only options travel in `options`.
export const gatewayProviders = ['anthropic', 'openai'] as const
export type GatewayProvider = (typeof gatewayProviders)[number]

export type ChatRole = 'user' | 'assistant'
export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatRequest {
  model: string
  /** Anthropic takes it apart from the messages, OpenAI as a first message; the adapters do each. */
  system?: string
  messages: readonly ChatMessage[]
  temperature?: number
  maxTokens: number
  /** Provider-specific parameters, validated by the adapter that takes them and ignored by none silently. */
  options?: Readonly<Record<string, unknown>>
}

export interface ChatUsage {
  tokensIn: number
  tokensOut: number
}

export type FinishReason = 'stop' | 'length' | 'refusal' | 'other'

export interface ChatAnswer {
  text: string
  model: string
  finish: FinishReason
  usage: ChatUsage
}

/** One piece of a streamed answer: text as it arrives, then the end with usage. */
export type ChatChunk = { kind: 'text'; text: string } | { kind: 'end'; finish: FinishReason; model: string; usage: ChatUsage }

/** What a provider adapter does (#950). `signal` cancels the call; a deadline is the adapter's own. */
export interface ChatProvider {
  readonly name: GatewayProvider
  /** Whether the key is live: `rejected` is the provider refusing it, `unavailable` anything else. */
  validateCredentials: (signal?: AbortSignal) => Promise<'ok' | 'rejected' | 'unavailable'>
  listModels: (signal?: AbortSignal) => Promise<readonly string[]>
  generateResponse: (request: ChatRequest, signal?: AbortSignal) => Promise<ChatAnswer>
  streamResponse: (request: ChatRequest, signal?: AbortSignal) => AsyncIterable<ChatChunk>
}

/** Why a call failed, in words that carry no key, header or upstream body (error normalisation). */
export const gatewayErrorCodes = ['INVALID_CREDENTIALS', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'CANCELLED', 'BAD_REQUEST', 'MODEL_NOT_FOUND', 'CONTENT_REFUSED'] as const
export type GatewayErrorCode = (typeof gatewayErrorCodes)[number]

/** The failures worth another try: the provider was busy or unreachable. A refused key or a bad request is not. */
export const transientCodes: ReadonlySet<GatewayErrorCode> = new Set(['RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT'])

export class GatewayError extends Error {
  override name = 'GatewayError'
  constructor(
    readonly code: GatewayErrorCode,
    /** Seconds the provider asked us to wait, when it said. */
    readonly retryAfter: number | null = null,
  ) {
    super(code)
  }
}
