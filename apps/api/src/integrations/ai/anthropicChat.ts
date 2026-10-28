import Anthropic from '@anthropic-ai/sdk'
import { GatewayError, type ChatAnswer, type ChatChunk, type ChatProvider, type ChatRequest, type FinishReason } from './gateway'

// Claude through the official SDK (#950). The key is the caller's, held here only for the call.
const timeoutMs = 60_000

const finishOf = (reason: string | null): FinishReason => (reason === 'end_turn' || reason === 'stop_sequence' ? 'stop' : reason === 'max_tokens' ? 'length' : reason === 'refusal' ? 'refusal' : 'other')

/** A provider failure as one of ours: no body, header or key goes on. */
export const anthropicFailure = (error: unknown): GatewayError => {
  if (error instanceof GatewayError) return error
  if (error instanceof Anthropic.APIUserAbortError) return new GatewayError('CANCELLED')
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new GatewayError('TIMEOUT')
  if (error instanceof Anthropic.APIConnectionError) return new GatewayError('PROVIDER_UNAVAILABLE')
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0
    if (status === 401 || status === 403) return new GatewayError('INVALID_CREDENTIALS')
    if (status === 404) return new GatewayError('MODEL_NOT_FOUND')
    if (status === 429) return new GatewayError('RATE_LIMITED', Number(error.headers?.get('retry-after')) || null)
    if (status === 400 || status === 413 || status === 422) return new GatewayError('BAD_REQUEST')
    return new GatewayError('PROVIDER_UNAVAILABLE')
  }
  return new GatewayError('PROVIDER_UNAVAILABLE')
}

const paramsOf = (request: ChatRequest) => {
  const blocks = typeof request.system === 'string' ? (request.system === '' ? [] : [{ type: 'text' as const, text: request.system }]) : (request.system ?? [])
  const system = [...blocks, ...request.messages.filter((m) => m.role === 'system').map(({ content }) => ({ type: 'text' as const, text: content }))]
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    ...(system.length > 0 ? { system } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    messages: request.messages.flatMap((m) => (m.role === 'system' ? [] : [{ role: m.role, content: m.content }])),
  }
}

/** A key, or the access token of a Claude sign-in (Bearer, with the OAuth beta header). */
export const anthropicChat = (credential: string | { authToken: string }): ChatProvider => {
  const client = new Anthropic({
    ...(typeof credential === 'string' ? { apiKey: credential } : { apiKey: null, authToken: credential.authToken, defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' } }),
    timeout: timeoutMs,
    maxRetries: 0,
  })
  return {
    name: 'anthropic',
    validateCredentials: async (signal) => {
      try {
        await client.models.list({ limit: 1 }, { signal })
        return 'ok'
      } catch (error) {
        return anthropicFailure(error).code === 'INVALID_CREDENTIALS' ? 'rejected' : 'unavailable'
      }
    },
    listModels: async (signal) => {
      try {
        return (await client.models.list({ limit: 100 }, { signal })).data.map((m) => m.id)
      } catch (error) {
        throw anthropicFailure(error)
      }
    },
    generateResponse: async (request, signal): Promise<ChatAnswer> => {
      try {
        const message = await client.messages.create(paramsOf(request), { signal })
        return {
          text: message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''),
          model: message.model,
          finish: finishOf(message.stop_reason),
          usage: { tokensIn: message.usage.input_tokens, tokensOut: message.usage.output_tokens },
        }
      } catch (error) {
        throw anthropicFailure(error)
      }
    },
    streamResponse: async function* (request, signal): AsyncGenerator<ChatChunk> {
      try {
        const stream = client.messages.stream(paramsOf(request), { signal })
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { kind: 'text', text: event.delta.text }
        }
        const message = await stream.finalMessage()
        yield { kind: 'end', finish: finishOf(message.stop_reason), model: message.model, usage: { tokensIn: message.usage.input_tokens, tokensOut: message.usage.output_tokens } }
      } catch (error) {
        throw anthropicFailure(error)
      }
    },
  }
}
