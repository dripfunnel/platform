import { z } from 'zod'
import { UnsupportedFeature, type CanonicalFinish, type CanonicalRequest, type CanonicalResponse, type CanonicalStreamEvent, type CanonicalToolChoice, type ProviderCapabilities } from '../canonical'
import { GatewayError } from '../gateway'
import { checkRequest, checkToolPairing, clampTemperature, dataUrl, refuseErrorFlags, turnsOf } from './shared'
import { advanceToolCall, endToolCall, errorEvent, guardedStream, newToolCall, openaiErrorCode, parseOrThrow, typeOf, usageOf, type ToolCallState } from './streams'
import type { RequestTranslator, ResponseTranslator, StreamTranslatorFactory } from './types'

// Responses API (docs/api/SAAS.md §9.3). Stateless: the whole conversation travels in `input`, and `store` is the executor's to set.
const maxTemperature = 2

type InputItem =
  | { role: 'developer'; content: string }
  | { role: 'user'; content: ({ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string })[] }
  | { role: 'assistant'; content: { type: 'output_text'; text: string }[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }

export interface OpenAiResponsesBody {
  model: string
  input: InputItem[]
  instructions?: string
  max_output_tokens: number
  temperature?: number
  reasoning?: { effort: 'low' | 'medium' | 'high' }
  text?: { format: { type: 'json_schema'; name: string; schema: Record<string, unknown> } }
  tools?: { type: 'function'; name: string; description?: string; parameters: Record<string, unknown> }[]
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; name: string }
}

const toolChoiceOf = (choice: CanonicalToolChoice): NonNullable<OpenAiResponsesBody['tool_choice']> => (typeof choice === 'object' ? { type: 'function', name: choice.name } : choice)

export const openaiResponsesRequest: RequestTranslator<OpenAiResponsesBody> = {
  id: 'canonical->openai-responses',
  from: 'canonical',
  to: 'openai-responses',
  translate: (request: CanonicalRequest, capabilities: ProviderCapabilities): OpenAiResponsesBody => {
    checkRequest(request, capabilities)
    // The Responses API has no stop sequences.
    if (request.stop?.length) throw new UnsupportedFeature('stop sequences')
    const turns = turnsOf(request.messages)
    refuseErrorFlags(turns)
    checkToolPairing(turns)
    const input: InputItem[] = request.developer ? [{ role: 'developer', content: request.developer }] : []
    for (const turn of turns) {
      if (turn.role === 'user') {
        for (const result of turn.results) input.push({ type: 'function_call_output', call_id: result.callId, output: result.content })
        if (turn.content.length > 0) input.push({ role: 'user', content: turn.content.map((part) => (part.type === 'text' ? { type: 'input_text' as const, text: part.text } : { type: 'input_image' as const, image_url: dataUrl(part) })) })
        continue
      }
      const text = turn.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
      if (text !== '') input.push({ role: 'assistant', content: [{ type: 'output_text', text }] })
      for (const part of turn.parts) if (part.type === 'tool_call') input.push({ type: 'function_call', call_id: part.id, name: part.name, arguments: part.arguments === '' ? '{}' : part.arguments })
    }
    return {
      model: request.model,
      input,
      ...(request.system ? { instructions: request.system } : {}),
      max_output_tokens: request.maxTokens,
      ...(request.temperature !== undefined ? { temperature: clampTemperature(request.temperature, maxTemperature) } : {}),
      ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
      ...(request.structuredOutput ? { text: { format: { type: 'json_schema' as const, name: request.structuredOutput.name, schema: { ...request.structuredOutput.schema } } } } : {}),
      ...(request.tools?.length ? { tools: request.tools.map((t) => ({ type: 'function' as const, name: t.name, ...(t.description ? { description: t.description } : {}), parameters: { ...t.parameters } })) } : {}),
      ...(request.toolChoice !== undefined ? { tool_choice: toolChoiceOf(request.toolChoice) } : {}),
    }
  },
}

const usageSchema = z.object({ input_tokens: z.number().nullish(), output_tokens: z.number().nullish(), input_tokens_details: z.object({ cached_tokens: z.number().nullish() }).nullish() })
const usageFrom = (usage: z.infer<typeof usageSchema> | null | undefined) => usageOf(usage?.input_tokens, usage?.output_tokens, usage?.input_tokens_details?.cached_tokens)

const errorSchema = z.object({ code: z.unknown().optional(), type: z.unknown().optional() })

const finishOf = (status: string | undefined, reason: string | null | undefined, hasCalls: boolean, refused: boolean): CanonicalFinish => {
  if (refused || reason === 'content_filter') return 'refusal'
  if (status === 'incomplete') return reason === 'max_output_tokens' ? 'length' : 'other'
  return hasCalls ? 'tool_use' : 'stop'
}

const itemSchema = z.object({ type: z.string(), call_id: z.string().optional(), name: z.string().optional(), arguments: z.string().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })

const responseSchema = z.object({
  model: z.string(),
  status: z.string().optional(),
  output: z.array(itemSchema).optional(),
  usage: usageSchema.nullish(),
  incomplete_details: z.object({ reason: z.string().nullish() }).nullish(),
  error: errorSchema.nullish(),
})

export const openaiResponsesResponse: ResponseTranslator<unknown> = {
  from: 'openai-responses',
  parse: (raw: unknown): CanonicalResponse => {
    const response = parseOrThrow(responseSchema, raw)
    if (response.error || response.status === 'failed') throw new GatewayError(openaiErrorCode(response.error?.code, response.error?.type))
    if (response.status !== undefined && response.status !== 'completed' && response.status !== 'incomplete') throw new GatewayError('PROVIDER_UNAVAILABLE')
    const output = response.output ?? []
    const parts = output.filter((item) => item.type === 'message').flatMap((item) => item.content ?? [])
    const toolCalls = output
      .filter((item) => item.type === 'function_call')
      .map((item) => {
        if (!item.call_id || !item.name) throw new GatewayError('PROVIDER_UNAVAILABLE')
        return { id: item.call_id, name: item.name, arguments: item.arguments ?? '' }
      })
    return {
      text: parts.flatMap((part) => (part.type === 'output_text' ? [part.text ?? ''] : [])).join(''),
      toolCalls,
      finish: finishOf(response.status, response.incomplete_details?.reason, toolCalls.length > 0, parts.some((part) => part.type === 'refusal')),
      usage: usageFrom(response.usage),
      model: response.model,
    }
  },
}

const terminalSchema = z.object({ response: responseSchema.partial({ model: true }) })
const knownEvents: ReadonlySet<string> = new Set([
  'response.output_text.delta',
  'response.refusal.delta',
  'response.output_item.added',
  'response.function_call_arguments.delta',
  'response.output_item.done',
  'response.completed',
  'response.incomplete',
  'response.failed',
  'error',
])
const eventSchema = z.object({ type: z.string(), delta: z.string().optional(), output_index: z.number().optional(), item: itemSchema.optional(), code: z.unknown().optional() })

export const openaiResponsesStream: StreamTranslatorFactory<unknown> = {
  from: 'openai-responses',
  create: () => {
    let refused = false
    const calls = new Map<number, { state: ToolCallState; at: number }>()
    const callAt = (outputIndex: number, id?: string, name?: string) => {
      const known = calls.get(outputIndex)
      if (known) {
        known.state.id ??= id
        known.state.name ??= name
        return known
      }
      const created = { state: newToolCall(id, name), at: calls.size }
      calls.set(outputIndex, created)
      return created
    }
    return guardedStream((raw) => {
      // Events of other kinds (reasoning, content parts, rate-limit updates) carry nothing this translator needs.
      if (!knownEvents.has(typeOf(raw))) return []
      const event = parseOrThrow(eventSchema, raw)
      const index = event.output_index ?? 0
      switch (event.type) {
        case 'response.output_text.delta':
          return event.delta ? [{ kind: 'text', text: event.delta }] : []
        case 'response.refusal.delta':
          refused = true
          return []
        case 'response.output_item.added':
          if (event.item?.type !== 'function_call') return []
          return ((call) => advanceToolCall(call.state, call.at))(callAt(index, event.item.call_id, event.item.name))
        case 'response.function_call_arguments.delta': {
          const call = calls.get(index)
          if (!call) throw new GatewayError('PROVIDER_UNAVAILABLE')
          call.state.args += event.delta ?? ''
          return advanceToolCall(call.state, call.at)
        }
        case 'response.output_item.done': {
          if (event.item?.type !== 'function_call') return []
          const call = callAt(index, event.item.call_id, event.item.name)
          // The finished item carries the whole arguments; it wins over the accumulated deltas.
          if (event.item.arguments !== undefined && event.item.arguments.length >= call.state.args.length) call.state.args = event.item.arguments
          return endToolCall(call.state, call.at)
        }
        case 'error':
          return [errorEvent(openaiErrorCode(event.code))]
        default: {
          const { response } = parseOrThrow(terminalSchema, raw)
          if (event.type === 'response.failed') return [errorEvent(openaiErrorCode(response.error?.code, response.error?.type))]
          const open: CanonicalStreamEvent[] = [...calls.values()].flatMap((call) => endToolCall(call.state, call.at))
          if (open.some((e) => e.kind === 'error')) return open
          if (event.type === 'response.completed' && response.status !== undefined && response.status !== 'completed') return [errorEvent('PROVIDER_UNAVAILABLE')]
          const finish = finishOf(event.type === 'response.incomplete' ? 'incomplete' : 'completed', response.incomplete_details?.reason, calls.size > 0, refused)
          return [...open, { kind: 'usage', usage: usageFrom(response.usage) }, { kind: 'end', finish, model: response.model ?? '' }]
        }
      }
    })
  },
}
