import { GatewayError, type ChatAnswer, type ChatChunk, type ChatProvider, type ChatRequest, type FinishReason } from './gateway'

// ChatGPT's models through OpenAI's documented Chat Completions API, API key only (#950; THIRD-PARTY-ACCESS §2.6).
// The endpoint is fixed: nothing a caller sends picks a host (SSRF), and no header comes from a caller.
const endpoint = 'https://api.openai.com/v1'
const timeoutMs = 60_000
/** Options OpenAI takes through `options`; anything else is refused rather than passed on. */
export const openaiOptions = ['top_p', 'presence_penalty', 'frequency_penalty', 'seed', 'stop', 'response_format'] as const

const finishOf = (reason: string | null | undefined): FinishReason => (reason === 'stop' ? 'stop' : reason === 'length' ? 'length' : reason === 'content_filter' ? 'refusal' : 'other')

const failureOf = (status: number, retryAfter: string | null): GatewayError => {
  if (status === 401 || status === 403) return new GatewayError('INVALID_CREDENTIALS')
  if (status === 404) return new GatewayError('MODEL_NOT_FOUND')
  if (status === 429) return new GatewayError('RATE_LIMITED', Number(retryAfter) || null)
  if (status === 400 || status === 413 || status === 422) return new GatewayError('BAD_REQUEST')
  return new GatewayError('PROVIDER_UNAVAILABLE')
}

const bodyOf = (request: ChatRequest, stream: boolean): string => {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(request.options ?? {})) {
    if (!(openaiOptions as readonly string[]).includes(key)) throw new GatewayError('BAD_REQUEST')
    extra[key] = value
  }
  return JSON.stringify({
    ...extra,
    model: request.model,
    max_completion_tokens: request.maxTokens,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    messages: [...(request.system ? [{ role: 'system', content: request.system }] : []), ...request.messages.map((m) => ({ role: m.role, content: m.content }))],
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  })
}

const send = async (apiKey: string, path: string, init: { method: string; body?: string | undefined; signal?: AbortSignal | undefined }): Promise<Response> => {
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline
  let response: Response
  try {
    response = await fetch(`${endpoint}${path}`, { method: init.method, ...(init.body !== undefined ? { body: init.body } : {}), signal, headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' } })
  } catch {
    throw new GatewayError(init.signal?.aborted ? 'CANCELLED' : deadline.aborted ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE')
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw failureOf(response.status, response.headers.get('retry-after'))
  }
  return response
}

interface Completion {
  model: string
  choices: { message?: { content?: string | null }; finish_reason?: string | null; delta?: { content?: string | null } }[]
  usage?: { prompt_tokens: number; completion_tokens: number } | null
}

export const openaiChat = (apiKey: string): ChatProvider => ({
  name: 'openai',
  validateCredentials: async (signal) => {
    try {
      await send(apiKey, '/models', { method: 'GET', signal })
      return 'ok'
    } catch (error) {
      return error instanceof GatewayError && error.code === 'INVALID_CREDENTIALS' ? 'rejected' : 'unavailable'
    }
  },
  listModels: async (signal) => {
    const body = (await (await send(apiKey, '/models', { method: 'GET', signal })).json()) as { data?: { id: string }[] }
    return (body.data ?? []).map((m) => m.id)
  },
  generateResponse: async (request, signal): Promise<ChatAnswer> => {
    const completion = (await (await send(apiKey, '/chat/completions', { method: 'POST', body: bodyOf(request, false), signal })).json()) as Completion
    const choice = completion.choices[0]
    return {
      text: choice?.message?.content ?? '',
      model: completion.model,
      finish: finishOf(choice?.finish_reason),
      usage: { tokensIn: completion.usage?.prompt_tokens ?? 0, tokensOut: completion.usage?.completion_tokens ?? 0 },
    }
  },
  streamResponse: async function* (request, signal): AsyncGenerator<ChatChunk> {
    const response = await send(apiKey, '/chat/completions', { method: 'POST', body: bodyOf(request, true), signal })
    if (!response.body) throw new GatewayError('PROVIDER_UNAVAILABLE')
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    let finish: FinishReason = 'other'
    let model = request.model
    let usage = { tokensIn: 0, tokensOut: 0 }
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += value
        let at: number
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at).trim()
          buffer = buffer.slice(at + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          const part = JSON.parse(data) as Completion
          model = part.model || model
          const choice = part.choices[0]
          if (choice?.delta?.content) yield { kind: 'text', text: choice.delta.content }
          if (choice?.finish_reason) finish = finishOf(choice.finish_reason)
          if (part.usage) usage = { tokensIn: part.usage.prompt_tokens, tokensOut: part.usage.completion_tokens }
        }
      }
    } catch (error) {
      if (error instanceof GatewayError) throw error
      throw new GatewayError(signal?.aborted ? 'CANCELLED' : 'PROVIDER_UNAVAILABLE')
    } finally {
      reader.releaseLock()
    }
    yield { kind: 'end', finish, model, usage }
  },
})
