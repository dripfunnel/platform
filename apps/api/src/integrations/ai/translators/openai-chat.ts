import { z } from 'zod'
import { UnsupportedFeature, type CanonicalFinish, type CanonicalRequest, type CanonicalResponse, type CanonicalStreamEvent, type CanonicalToolChoice, type ProviderCapabilities } from '../canonical'
import { GatewayError } from '../gateway'
import { checkRequest, checkToolPairing, clampTemperature, dataUrl, refuseErrorFlags, turnsOf } from './shared'
import { advanceToolCall, endToolCall, errorEvent, guardedStream, newToolCall, openaiErrorCode, parseOrThrow, usageOf, type ToolCallState } from './streams'
import type { RequestTranslator, ResponseTranslator, StreamTranslatorFactory } from './types'

// Chat Completions (docs/api/SAAS.md §9.3). OpenAI takes temperature up to 2 and at most four stop sequences.
const maxTemperature = 2
const maxStop = 4

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
type ChatMessage =
  | { role: 'system' | 'developer'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface OpenAiChatBody {
  model: string
  messages: ChatMessage[]
  max_completion_tokens: number
  temperature?: number
  stop?: string[]
  reasoning_effort?: 'low' | 'medium' | 'high'
  response_format?: { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown> } }
  tools?: { type: 'function'; function: { name: string; description?: string; parameters: Record<string, unknown> } }[]
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}

const toolChoiceOf = (choice: CanonicalToolChoice): NonNullable<OpenAiChatBody['tool_choice']> => (typeof choice === 'object' ? { type: 'function', function: { name: choice.name } } : choice)

export const openaiChatRequest: RequestTranslator<OpenAiChatBody> = {
  id: 'canonical->openai-chat',
  from: 'canonical',
  to: 'openai-chat',
  translate: (request: CanonicalRequest, capabilities: ProviderCapabilities): OpenAiChatBody => {
    checkRequest(request, capabilities)
    if ((request.stop?.length ?? 0) > maxStop) throw new UnsupportedFeature(`more than ${maxStop} stop sequences`)
    const turns = turnsOf(request.messages)
    refuseErrorFlags(turns)
    checkToolPairing(turns)
    const messages: ChatMessage[] = [
      ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
      ...(request.developer ? [{ role: 'developer' as const, content: request.developer }] : []),
    ]
    for (const turn of turns) {
      if (turn.role === 'assistant') {
        const text = turn.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
        const calls = turn.parts.flatMap((part) => (part.type === 'tool_call' ? [{ id: part.id, type: 'function' as const, function: { name: part.name, arguments: part.arguments === '' ? '{}' : part.arguments } }] : []))
        messages.push({ role: 'assistant', content: text === '' ? null : text, ...(calls.length > 0 ? { tool_calls: calls } : {}) })
        continue
      }
      for (const result of turn.results) messages.push({ role: 'tool', tool_call_id: result.callId, content: result.content })
      const only = turn.content[0]
      if (!only) continue
      messages.push({
        role: 'user',
        content: turn.content.length === 1 && only.type === 'text' ? only.text : turn.content.map((part): ContentPart => (part.type === 'text' ? { type: 'text', text: part.text } : { type: 'image_url', image_url: { url: dataUrl(part) } })),
      })
    }
    return {
      model: request.model,
      messages,
      max_completion_tokens: request.maxTokens,
      ...(request.temperature !== undefined ? { temperature: clampTemperature(request.temperature, maxTemperature) } : {}),
      ...(request.stop?.length ? { stop: [...request.stop] } : {}),
      ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
      ...(request.structuredOutput ? { response_format: { type: 'json_schema' as const, json_schema: { name: request.structuredOutput.name, schema: { ...request.structuredOutput.schema } } } } : {}),
      ...(request.tools?.length ? { tools: request.tools.map((t) => ({ type: 'function' as const, function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: { ...t.parameters } } })) } : {}),
      ...(request.toolChoice !== undefined ? { tool_choice: toolChoiceOf(request.toolChoice) } : {}),
    }
  },
}

const finishOf = (reason: string | null | undefined, refused: boolean): CanonicalFinish => {
  if (refused || reason === 'content_filter') return 'refusal'
  if (reason === 'stop') return 'stop'
  if (reason === 'length') return 'length'
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use'
  return 'other'
}

const usageSchema = z.object({ prompt_tokens: z.number().nullish(), completion_tokens: z.number().nullish(), prompt_tokens_details: z.object({ cached_tokens: z.number().nullish() }).nullish() })
const usageFrom = (usage: z.infer<typeof usageSchema> | null | undefined) => usageOf(usage?.prompt_tokens, usage?.completion_tokens, usage?.prompt_tokens_details?.cached_tokens)

const errorSchema = z.object({ error: z.object({ code: z.unknown().optional(), type: z.unknown().optional() }) })

const completionSchema = z.object({
  model: z.string(),
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullish(),
        refusal: z.string().nullish(),
        tool_calls: z.array(z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }) })).nullish(),
      }),
      finish_reason: z.string().nullable(),
    }),
  ),
  usage: usageSchema.nullish(),
})

export const openaiChatResponse: ResponseTranslator<unknown> = {
  from: 'openai-chat',
  parse: (raw: unknown): CanonicalResponse => {
    const error = errorSchema.safeParse(raw)
    if (error.success) throw new GatewayError(openaiErrorCode(error.data.error.code, error.data.error.type))
    const completion = parseOrThrow(completionSchema, raw)
    const choice = completion.choices[0]
    if (!choice) throw new GatewayError('PROVIDER_UNAVAILABLE')
    return {
      text: choice.message.content ?? '',
      toolCalls: (choice.message.tool_calls ?? []).map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })),
      finish: finishOf(choice.finish_reason, Boolean(choice.message.refusal)),
      usage: usageFrom(completion.usage),
      model: completion.model,
    }
  },
}

const chunkSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        delta: z.object({
          content: z.string().nullish(),
          refusal: z.string().nullish(),
          tool_calls: z.array(z.object({ index: z.number(), id: z.string().nullish(), function: z.object({ name: z.string().nullish(), arguments: z.string().nullish() }).nullish() })).nullish(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
  usage: usageSchema.nullish(),
})

/** The executor feeds the stream's `data: [DONE]` line as this string. Request `stream_options.include_usage`, or usage stays zero. */
export const openaiDone = '[DONE]'

export const openaiChatStream: StreamTranslatorFactory<unknown> = {
  from: 'openai-chat',
  create: () => {
    let model = ''
    let finishReason: string | null = null
    let refused = false
    let usage: z.infer<typeof usageSchema> | null = null
    const calls = new Map<number, ToolCallState>()
    const closeCalls = (): CanonicalStreamEvent[] => [...calls].flatMap(([index, call]) => endToolCall(call, index))
    const complete = (): CanonicalStreamEvent[] => {
      const events = closeCalls()
      if (events.some((event) => event.kind === 'error')) return events
      if (finishReason === null) return [...events, errorEvent('PROVIDER_UNAVAILABLE')]
      return [...events, { kind: 'usage', usage: usageFrom(usage) }, { kind: 'end', finish: finishOf(finishReason, refused), model }]
    }
    const stream = guardedStream((raw) => {
      if (raw === openaiDone) return complete()
      const error = errorSchema.safeParse(raw)
      if (error.success) return [errorEvent(openaiErrorCode(error.data.error.code, error.data.error.type))]
      const chunk = parseOrThrow(chunkSchema, raw)
      model = chunk.model ?? model
      usage = chunk.usage ?? usage
      const events: CanonicalStreamEvent[] = []
      for (const choice of chunk.choices ?? []) {
        if (choice.delta.refusal) refused = true
        if (choice.delta.content) events.push({ kind: 'text', text: choice.delta.content })
        for (const delta of choice.delta.tool_calls ?? []) {
          const call = calls.get(delta.index) ?? newToolCall()
          calls.set(delta.index, call)
          call.id = delta.id ?? call.id
          call.name = delta.function?.name ?? call.name
          call.args += delta.function?.arguments ?? ''
          events.push(...advanceToolCall(call, delta.index))
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason
          events.push(...closeCalls())
        }
      }
      return events
    })
    return {
      feed: stream.feed,
      // A source that drops the `[DONE]` line still ends cleanly once the finish reason and the usage chunk (the last one) arrived.
      finish: () => (finishReason !== null && usage !== null ? stream.feed(openaiDone) : stream.finish()),
    }
  },
}
