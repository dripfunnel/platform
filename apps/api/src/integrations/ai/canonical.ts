// The one internal request/response shape every provider format is translated from and to (docs/api/SAAS.md §9.3).
import type { FinishReason, GatewayErrorCode } from './gateway'

export type CanonicalPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; base64: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_result'; callId: string; content: string; isError?: boolean }

export interface CanonicalMessage {
  role: 'user' | 'assistant' | 'tool'
  content: readonly CanonicalPart[]
}

export interface CanonicalTool {
  name: string
  description?: string
  /** JSON Schema of the arguments. */
  parameters: Readonly<Record<string, unknown>>
}

export type CanonicalToolChoice = 'auto' | 'none' | 'required' | { name: string }
export type ReasoningEffort = 'low' | 'medium' | 'high'

/** The caller's abort signal travels apart from this, as the executors' argument. */
export interface CanonicalRequest {
  model: string
  system?: string
  /** Higher-priority instructions than `system`; a format without that role raises UnsupportedFeature. */
  developer?: string
  messages: readonly CanonicalMessage[]
  tools?: readonly CanonicalTool[]
  toolChoice?: CanonicalToolChoice
  maxTokens: number
  temperature?: number
  reasoningEffort?: ReasoningEffort
  structuredOutput?: { name: string; schema: Readonly<Record<string, unknown>> }
  stop?: readonly string[]
}

export interface CanonicalUsage {
  tokensIn: number
  tokensOut: number
  cachedTokensIn: number
}

export type CanonicalFinish = FinishReason | 'tool_use' | 'error'

export interface CanonicalToolCall {
  id: string
  name: string
  arguments: string
}

export interface CanonicalResponse {
  text: string
  toolCalls: readonly CanonicalToolCall[]
  finish: CanonicalFinish
  usage: CanonicalUsage
  model: string
}

export type CanonicalStreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call_start'; index: number; id: string; name: string }
  | { kind: 'tool_call_delta'; index: number; arguments: string }
  | { kind: 'tool_call_end'; index: number }
  | { kind: 'usage'; usage: CanonicalUsage }
  | { kind: 'end'; finish: CanonicalFinish; model: string }
  | { kind: 'error'; code: GatewayErrorCode; retryAfter: number | null }

export interface ProviderCapabilities {
  images: boolean
  tools: boolean
  reasoning: boolean
  structuredOutput: boolean
  developerRole: boolean
  streaming: boolean
  maxOutputTokens: number
}

/** A request asks for something the target format or model cannot do; translators raise it rather than drop the feature. */
export class UnsupportedFeature extends Error {
  override name = 'UnsupportedFeature'
  constructor(readonly feature: string) {
    super(`unsupported: ${feature}`)
  }
}
