import type { z } from 'zod'
import type { CanonicalStreamEvent, CanonicalUsage } from '../canonical'
import { GatewayError, type GatewayErrorCode } from '../gateway'
import type { StreamTranslator } from './types'

export const errorEvent = (code: GatewayErrorCode): CanonicalStreamEvent => ({ kind: 'error', code, retryAfter: null })

/** `tokensIn` counts cached tokens too and `cachedTokensIn` is the part of it served from cache, as the API-key provider meters it. */
export const usageOf = (tokensIn: number | null | undefined, tokensOut: number | null | undefined, cachedTokensIn: number | null | undefined): CanonicalUsage => ({ tokensIn: tokensIn ?? 0, tokensOut: tokensOut ?? 0, cachedTokensIn: cachedTokensIn ?? 0 })

/** A body that failed its schema is a provider fault, never a success with fields missing. */
export const parseOrThrow = <T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> => {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new GatewayError('PROVIDER_UNAVAILABLE')
  return parsed.data
}

/** The terminal events (`end`, `error`) seal the stream: later events are ignored, and a source that ends unsealed fails. */
export const guardedStream = (handle: (raw: unknown) => CanonicalStreamEvent[]): StreamTranslator<unknown> => {
  let sealed = false
  const seal = (events: CanonicalStreamEvent[]): CanonicalStreamEvent[] => {
    const at = events.findIndex((event) => event.kind === 'end' || event.kind === 'error')
    if (at < 0) return events
    sealed = true
    return events.slice(0, at + 1)
  }
  return {
    feed: (raw) => {
      if (sealed) return []
      try {
        return seal(handle(raw))
      } catch (error) {
        if (error instanceof GatewayError) return seal([errorEvent(error.code)])
        throw error
      }
    },
    finish: () => (sealed ? [] : seal([errorEvent('PROVIDER_UNAVAILABLE')])),
  }
}

/** The `type` of a raw event, or '' when it has none. */
export const typeOf = (raw: unknown): string => (typeof raw === 'object' && raw !== null && 'type' in raw && typeof raw.type === 'string' ? raw.type : '')

export interface ToolCallState {
  id?: string | null | undefined
  name?: string | null | undefined
  args: string
  sent: number
  started: boolean
  ended: boolean
}

export const newToolCall = (id?: string | null, name?: string | null, args = ''): ToolCallState => ({ id, name, args, sent: 0, started: false, ended: false })

/** Starts the call once its id and name are both known, then sends whatever arguments have not gone out yet. */
export const advanceToolCall = (call: ToolCallState, index: number): CanonicalStreamEvent[] => {
  const events: CanonicalStreamEvent[] = []
  if (!call.started && call.id && call.name) {
    call.started = true
    events.push({ kind: 'tool_call_start', index, id: call.id, name: call.name })
  }
  if (call.started && call.args.length > call.sent) {
    events.push({ kind: 'tool_call_delta', index, arguments: call.args.slice(call.sent) })
    call.sent = call.args.length
  }
  return events
}

const isJsonObject = (text: string): boolean => {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  } catch {
    return false
  }
}

/** Ends a call only when its arguments are a whole JSON object (none means `{}`); anything else is a truncated call, so an error. */
export const endToolCall = (call: ToolCallState, index: number): CanonicalStreamEvent[] => {
  if (call.ended) return []
  call.ended = true
  const events = advanceToolCall(call, index)
  if (!call.started || (call.args !== '' && !isJsonObject(call.args))) return [...events, errorEvent('PROVIDER_UNAVAILABLE')]
  if (call.args === '') events.push({ kind: 'tool_call_delta', index, arguments: '{}' })
  return [...events, { kind: 'tool_call_end', index }]
}

/** An OpenAI endpoint's error in a body or an event (the Codex usage-limit codes too), as one of ours. */
export const openaiErrorCode = (code: unknown, type?: unknown): GatewayErrorCode => {
  const key = typeof code === 'string' ? code : typeof type === 'string' ? type : ''
  if (['rate_limit_exceeded', 'insufficient_quota', 'usage_limit_reached'].includes(key) || key.startsWith('subscription_sharing_usage')) return 'RATE_LIMITED'
  if (['invalid_api_key', 'invalid_authentication', 'authentication_error', 'permission_denied', 'insufficient_permissions'].includes(key)) return 'INVALID_CREDENTIALS'
  if (key === 'model_not_found') return 'MODEL_NOT_FOUND'
  if (['content_filter', 'content_policy_violation'].includes(key)) return 'CONTENT_REFUSED'
  if (key === 'timeout') return 'TIMEOUT'
  if (['invalid_request_error', 'invalid_prompt', 'invalid_value', 'context_length_exceeded', 'unsupported_parameter'].includes(key)) return 'BAD_REQUEST'
  return 'PROVIDER_UNAVAILABLE'
}
