import { z } from 'zod'
import { UnsupportedFeature, type CanonicalFinish, type CanonicalRequest, type CanonicalResponse, type CanonicalToolChoice, type ProviderCapabilities } from '../canonical'
import { GatewayError, type GatewayErrorCode } from '../gateway'
import { advanceToolCall, endToolCall, errorEvent, guardedStream, newToolCall, parseOrThrow, typeOf, usageOf, type ToolCallState } from './streams'
import { argumentsObject, checkRequest, checkToolPairing, clampTemperature, mergeTurns, turnsOf } from './shared'
import type { RequestTranslator, ResponseTranslator, StreamTranslatorFactory } from './types'

// Messages API (docs/api/SAAS.md §9.3). Claude takes temperature up to 1 and the system apart from the turns.
const maxTemperature = 1

type TextBlock = { type: 'text'; text: string }
type ContentBlock =
  | TextBlock
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: true }

export interface AnthropicMessagesBody {
  model: string
  max_tokens: number
  system?: string
  messages: { role: 'user' | 'assistant'; content: ContentBlock[] }[]
  temperature?: number
  stop_sequences?: string[]
  tools?: { name: string; description?: string; input_schema: Record<string, unknown> }[]
  tool_choice?: { type: 'auto' | 'any' | 'none' } | { type: 'tool'; name: string }
  output_config?: { effort?: 'low' | 'medium' | 'high'; format?: { type: 'json_schema'; schema: Record<string, unknown> } }
}

const toolChoiceOf = (choice: CanonicalToolChoice): NonNullable<AnthropicMessagesBody['tool_choice']> =>
  typeof choice === 'object' ? { type: 'tool', name: choice.name } : { type: choice === 'required' ? 'any' : choice }

export const anthropicMessagesRequest: RequestTranslator<AnthropicMessagesBody> = {
  id: 'canonical->anthropic-messages',
  from: 'canonical',
  to: 'anthropic-messages',
  translate: (request: CanonicalRequest, capabilities: ProviderCapabilities): AnthropicMessagesBody => {
    checkRequest(request, capabilities)
    // The Messages API has no developer role, so it is refused whatever the capabilities say.
    if (request.developer) throw new UnsupportedFeature('developer instructions')
    const turns = mergeTurns(turnsOf(request.messages))
    if (turns[0]?.role !== 'user') throw new UnsupportedFeature('first turn must be a user turn')
    checkToolPairing(turns)
    const messages = turns.map((turn): AnthropicMessagesBody['messages'][number] => {
      if (turn.role === 'assistant') {
        return { role: 'assistant', content: turn.parts.map((part): ContentBlock => (part.type === 'text' ? { type: 'text', text: part.text } : { type: 'tool_use', id: part.id, name: part.name, input: argumentsObject(part.arguments) })) }
      }
      const results = turn.results.map((r): ContentBlock => ({ type: 'tool_result', tool_use_id: r.callId, content: r.content, ...(r.isError ? { is_error: true as const } : {}) }))
      const content = turn.content.map((part): ContentBlock => (part.type === 'text' ? { type: 'text', text: part.text } : { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.base64 } }))
      return { role: 'user', content: [...results, ...content] }
    })
    const output = {
      ...(request.reasoningEffort ? { effort: request.reasoningEffort } : {}),
      ...(request.structuredOutput ? { format: { type: 'json_schema' as const, schema: { ...request.structuredOutput.schema } } } : {}),
    }
    return {
      model: request.model,
      max_tokens: request.maxTokens,
      ...(request.system ? { system: request.system } : {}),
      messages,
      ...(request.temperature !== undefined ? { temperature: clampTemperature(request.temperature, maxTemperature) } : {}),
      ...(request.stop?.length ? { stop_sequences: [...request.stop] } : {}),
      ...(request.tools?.length ? { tools: request.tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}), input_schema: { ...t.parameters } })) } : {}),
      ...(request.toolChoice !== undefined ? { tool_choice: toolChoiceOf(request.toolChoice) } : {}),
      ...(Object.keys(output).length > 0 ? { output_config: output } : {}),
    }
  },
}

const errorCodes: Record<string, GatewayErrorCode> = {
  rate_limit_error: 'RATE_LIMITED',
  authentication_error: 'INVALID_CREDENTIALS',
  permission_error: 'INVALID_CREDENTIALS',
  invalid_request_error: 'BAD_REQUEST',
  request_too_large: 'BAD_REQUEST',
  not_found_error: 'MODEL_NOT_FOUND',
  timeout_error: 'TIMEOUT',
}
const errorCodeOf = (type: string | undefined): GatewayErrorCode => errorCodes[type ?? ''] ?? 'PROVIDER_UNAVAILABLE'

const finishOf = (reason: string | null | undefined): CanonicalFinish => {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop'
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'length'
  if (reason === 'refusal') return 'refusal'
  if (reason === 'tool_use') return 'tool_use'
  return 'other'
}

const usageSchema = z.object({ input_tokens: z.number().nullish(), output_tokens: z.number().nullish(), cache_read_input_tokens: z.number().nullish(), cache_creation_input_tokens: z.number().nullish() })
type AnthropicUsage = z.infer<typeof usageSchema>

/** Cached input counts in `tokensIn` too (cache reads and writes), as the API-key provider meters it (provider.ts). */
const usageFrom = (usage: AnthropicUsage) => usageOf((usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), usage.output_tokens, usage.cache_read_input_tokens)

const messageSchema = z.object({
  type: z.literal('message'),
  model: z.string(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional(), id: z.string().optional(), name: z.string().optional(), input: z.unknown().optional() })),
  stop_reason: z.string().nullable(),
  usage: usageSchema,
})
const errorBodySchema = z.object({ type: z.literal('error'), error: z.object({ type: z.string().optional() }) })

export const anthropicMessagesResponse: ResponseTranslator<unknown> = {
  from: 'anthropic-messages',
  parse: (raw: unknown): CanonicalResponse => {
    const error = errorBodySchema.safeParse(raw)
    if (error.success) throw new GatewayError(errorCodeOf(error.data.error.type))
    const message = parseOrThrow(messageSchema, raw)
    const toolCalls = message.content.flatMap((block) => {
      if (block.type !== 'tool_use') return []
      if (!block.id || !block.name) throw new GatewayError('PROVIDER_UNAVAILABLE')
      return [{ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }]
    })
    return {
      text: message.content.flatMap((block) => (block.type === 'text' ? [block.text ?? ''] : [])).join(''),
      toolCalls,
      finish: finishOf(message.stop_reason),
      usage: usageFrom(message.usage),
      model: message.model,
    }
  },
}

const streamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message_start'), message: z.object({ model: z.string().optional(), usage: usageSchema.optional() }) }),
  z.object({ type: z.literal('content_block_start'), index: z.number(), content_block: z.object({ type: z.string(), id: z.string().optional(), name: z.string().optional() }) }),
  z.object({ type: z.literal('content_block_delta'), index: z.number(), delta: z.object({ type: z.string(), text: z.string().optional(), partial_json: z.string().optional() }) }),
  z.object({ type: z.literal('content_block_stop'), index: z.number() }),
  z.object({ type: z.literal('message_delta'), delta: z.object({ stop_reason: z.string().nullable().optional() }), usage: usageSchema.optional() }),
  z.object({ type: z.literal('message_stop') }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('error'), error: z.object({ type: z.string().optional() }) }),
])

const knownEvents: ReadonlySet<string> = new Set(streamEventSchema.options.map((option) => option.shape.type.value))

export const anthropicMessagesStream: StreamTranslatorFactory<unknown> = {
  from: 'anthropic-messages',
  create: () => {
    let model = ''
    let usage: AnthropicUsage = {}
    let stopReason: string | null = null
    const calls = new Map<number, { state: ToolCallState; at: number }>()
    return guardedStream((raw) => {
      // The API adds event types over time: an unknown one is skipped, a known one malformed is a fault.
      if (!knownEvents.has(typeOf(raw))) return []
      const parsed = streamEventSchema.safeParse(raw)
      if (!parsed.success) throw new GatewayError('PROVIDER_UNAVAILABLE')
      const event = parsed.data
      switch (event.type) {
        case 'message_start':
          model = event.message.model ?? model
          usage = { ...usage, ...event.message.usage }
          return []
        case 'content_block_start': {
          if (event.content_block.type !== 'tool_use') return []
          const state = newToolCall(event.content_block.id, event.content_block.name)
          calls.set(event.index, { state, at: calls.size })
          return advanceToolCall(state, calls.size - 1)
        }
        case 'content_block_delta': {
          if (event.delta.type === 'text_delta') return event.delta.text ? [{ kind: 'text', text: event.delta.text }] : []
          if (event.delta.type !== 'input_json_delta') return []
          const call = calls.get(event.index)
          if (!call) throw new GatewayError('PROVIDER_UNAVAILABLE')
          call.state.args += event.delta.partial_json ?? ''
          return advanceToolCall(call.state, call.at)
        }
        case 'content_block_stop': {
          const call = calls.get(event.index)
          return call ? endToolCall(call.state, call.at) : []
        }
        case 'message_delta':
          stopReason = event.delta.stop_reason ?? stopReason
          usage = { ...usage, ...Object.fromEntries(Object.entries(event.usage ?? {}).filter(([, v]) => v != null)) }
          return []
        case 'message_stop': {
          if (stopReason === null || [...calls.values()].some((c) => !c.state.ended)) return [errorEvent('PROVIDER_UNAVAILABLE')]
          return [{ kind: 'usage', usage: usageFrom(usage) }, { kind: 'end', finish: finishOf(stopReason), model }]
        }
        case 'error':
          return [errorEvent(errorCodeOf(event.error.type))]
        case 'ping':
          return []
      }
    })
  },
}
