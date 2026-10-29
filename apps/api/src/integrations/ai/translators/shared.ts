import { UnsupportedFeature, type CanonicalMessage, type CanonicalPart, type CanonicalRequest, type ProviderCapabilities } from '../canonical'
import { GatewayError } from '../gateway'

export type TextPart = Extract<CanonicalPart, { type: 'text' }>
export type ImagePart = Extract<CanonicalPart, { type: 'image' }>
export type ToolCallPart = Extract<CanonicalPart, { type: 'tool_call' }>
export type ToolResultPart = Extract<CanonicalPart, { type: 'tool_result' }>

/** A user turn keeps its tool results apart from its text and images, because every format puts the results first. */
export type Turn = { role: 'user'; results: ToolResultPart[]; content: (TextPart | ImagePart)[] } | { role: 'assistant'; parts: (TextPart | ToolCallPart)[] }

/** Puts each part in a role that can carry it and drops empty text (an empty block is refused upstream), never a non-empty part. */
export const turnsOf = (messages: readonly CanonicalMessage[]): Turn[] => {
  if (messages.length === 0) throw new GatewayError('BAD_REQUEST')
  return messages.map((message): Turn => {
    if (message.role === 'assistant') {
      const parts: (TextPart | ToolCallPart)[] = []
      for (const part of message.content) {
        if (part.type === 'text') {
          if (part.text !== '') parts.push(part)
        } else if (part.type === 'tool_call') parts.push(part)
        else throw new UnsupportedFeature(`${part.type} in an assistant message`)
      }
      if (parts.length === 0) throw new GatewayError('BAD_REQUEST')
      return { role: 'assistant', parts }
    }
    const results: ToolResultPart[] = []
    const content: (TextPart | ImagePart)[] = []
    for (const part of message.content) {
      if (part.type === 'tool_result') results.push(part)
      else if (message.role === 'tool') throw new UnsupportedFeature(`${part.type} in a tool message`)
      else if (part.type === 'text') {
        if (part.text !== '') content.push(part)
      } else if (part.type === 'image') content.push(part)
      else throw new UnsupportedFeature('tool call in a user message')
    }
    if (results.length + content.length === 0) throw new GatewayError('BAD_REQUEST')
    return { role: 'user', results, content }
  })
}

/** Adjacent turns of one role become one, for a format that needs the roles to alternate. */
export const mergeTurns = (turns: readonly Turn[]): Turn[] =>
  turns.reduce<Turn[]>((merged, turn) => {
    const last = merged[merged.length - 1]
    if (last?.role === 'user' && turn.role === 'user') {
      last.results.push(...turn.results)
      last.content.push(...turn.content)
    } else if (last?.role === 'assistant' && turn.role === 'assistant') last.parts.push(...turn.parts)
    else merged.push(structuredClone(turn))
    return merged
  }, [])

const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && new Set(a).size === a.length && a.every((id) => b.includes(id))

/** Every format refuses a tool call with no result straight after it and a result with no call: say so before sending. */
export const checkToolPairing = (turns: readonly Turn[]): void => {
  turns.forEach((turn, at) => {
    const before = turns[at - 1]
    const after = turns[at + 1]
    if (turn.role === 'assistant') {
      const asked = turn.parts.flatMap((part) => (part.type === 'tool_call' ? [part.id] : []))
      if (asked.length > 0 && !sameIds(asked, after?.role === 'user' ? after.results.map((r) => r.callId) : [])) throw new GatewayError('BAD_REQUEST')
    } else if (turn.results.length > 0) {
      const asked = before?.role === 'assistant' ? before.parts.flatMap((part) => (part.type === 'tool_call' ? [part.id] : [])) : []
      if (!sameIds(turn.results.map((r) => r.callId), asked)) throw new GatewayError('BAD_REQUEST')
    }
  })
}

const nameOk = /^[\w-]{1,64}$/
const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

/** What every format refuses alike; each translator adds the limits of its own format. */
export const checkRequest = (request: CanonicalRequest, capabilities: ProviderCapabilities): void => {
  if (!Number.isInteger(request.maxTokens) || request.maxTokens < 1) throw new GatewayError('BAD_REQUEST')
  if (request.maxTokens > capabilities.maxOutputTokens) throw new UnsupportedFeature('maxTokens above the model limit')
  const parts = request.messages.flatMap((message) => message.content)
  for (const part of parts) {
    if (part.type !== 'image') continue
    if (!capabilities.images) throw new UnsupportedFeature('images')
    if (!imageTypes.includes(part.mediaType)) throw new UnsupportedFeature(`image type ${part.mediaType}`)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(part.base64)) throw new GatewayError('BAD_REQUEST')
  }
  const tools = request.tools ?? []
  if (!capabilities.tools && (tools.length > 0 || request.toolChoice !== undefined || parts.some((p) => p.type === 'tool_call' || p.type === 'tool_result'))) throw new UnsupportedFeature('tools')
  if (tools.some((tool) => !nameOk.test(tool.name)) || new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new GatewayError('BAD_REQUEST')
  if (request.toolChoice !== undefined && tools.length === 0) throw new GatewayError('BAD_REQUEST')
  const { toolChoice } = request
  if (typeof toolChoice === 'object' && !tools.some((tool) => tool.name === toolChoice.name)) throw new GatewayError('BAD_REQUEST')
  if (request.reasoningEffort !== undefined && !capabilities.reasoning) throw new UnsupportedFeature('reasoning effort')
  if (request.structuredOutput !== undefined && !capabilities.structuredOutput) throw new UnsupportedFeature('structured output')
  if (request.structuredOutput !== undefined && !nameOk.test(request.structuredOutput.name)) throw new GatewayError('BAD_REQUEST')
  if (request.developer && !capabilities.developerRole) throw new UnsupportedFeature('developer instructions')
  if (request.stop?.some((sequence) => sequence === '')) throw new GatewayError('BAD_REQUEST')
}

export const clampTemperature = (temperature: number, max: number): number => {
  if (Number.isNaN(temperature)) throw new GatewayError('BAD_REQUEST')
  return Math.min(max, Math.max(0, temperature))
}

/** The OpenAI formats have no flag for a failed tool result; refusing beats showing the model a failure as a success. */
export const refuseErrorFlags = (turns: readonly Turn[]): void => {
  if (turns.some((turn) => turn.role === 'user' && turn.results.some((result) => result.isError))) throw new UnsupportedFeature('tool result error flag')
}

export const dataUrl = (part: ImagePart): string => `data:${part.mediaType};base64,${part.base64}`

/** Tool-call arguments are JSON text in the canonical shape; Anthropic takes the object. */
export const argumentsObject = (text: string): Record<string, unknown> => {
  const value: unknown = text === '' ? {} : parseJson(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new GatewayError('BAD_REQUEST')
  return value as Record<string, unknown>
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    throw new GatewayError('BAD_REQUEST')
  }
}
