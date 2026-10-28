import { GatewayError, type ChatAnswer, type ChatChunk, type ChatProvider, type ChatRequest, type FinishReason } from '../gateway'

// ChatGPT-plan usage through the Codex Responses endpoint (THIRD-PARTY-ACCESS §2.6): store false, stream true. Private to
// OpenAI's own clients and unversioned, so it can change without notice.
const endpoint = 'https://chatgpt.com/backend-api/codex'
const timeoutMs = 120_000

/** `temperature` and every provider option are refused, never dropped: the route omits them and a caller must hear that. */
const instructionsOf = (request: ChatRequest): string => {
  const given = typeof request.system === 'string' ? [request.system] : (request.system ?? []).map((block) => block.text)
  return [...given, ...request.messages.filter((m) => m.role === 'system').map((m) => m.content)].filter((text) => text !== '').join('\n')
}

const bodyOf = (request: ChatRequest): string => {
  const instructions = instructionsOf(request)
  if (request.temperature !== undefined || (request.options && Object.keys(request.options).length > 0)) throw new GatewayError('BAD_REQUEST')
  return JSON.stringify({
    model: request.model,
    ...(instructions !== '' ? { instructions } : {}),
    input: request.messages.flatMap((m) => (m.role === 'system' ? [] : [{ role: m.role, content: [{ type: m.role === 'user' ? 'input_text' : 'output_text', text: m.content }] }])),
    store: false,
    stream: true,
  })
}

const failureOf = (status: number, retryAfter: string | null): GatewayError => {
  if (status === 401 || status === 403) return new GatewayError('INVALID_CREDENTIALS')
  if (status === 404) return new GatewayError('MODEL_NOT_FOUND')
  if (status === 429) return new GatewayError('RATE_LIMITED', Number(retryAfter) || null)
  if (status === 400 || status === 413 || status === 422) return new GatewayError('BAD_REQUEST')
  return new GatewayError('PROVIDER_UNAVAILABLE')
}

const send = async (token: string, accountId: string | null, path: string, init: { method: string; body?: string; signal?: AbortSignal | undefined }): Promise<Response> => {
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline
  let response: Response
  try {
    response = await fetch(`${endpoint}${path}`, { method: init.method, ...(init.body !== undefined ? { body: init.body } : {}), signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream', originator: 'codex_cli_rs', ...(accountId ? { 'chatgpt-account-id': accountId } : {}) } })
  } catch {
    throw new GatewayError(init.signal?.aborted ? 'CANCELLED' : deadline.aborted ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE')
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw failureOf(response.status, response.headers.get('retry-after'))
  }
  return response
}

/** The usage-limit codes arrive as `response.failed` after streaming has begun. */
const failedCode = (code: unknown): GatewayError => (typeof code === 'string' && code.startsWith('subscription_sharing_usage') ? new GatewayError('RATE_LIMITED') : new GatewayError('PROVIDER_UNAVAILABLE'))

interface StreamEvent {
  type?: string
  delta?: string
  response?: { model?: string; error?: { code?: string }; usage?: { input_tokens?: number; output_tokens?: number }; incomplete_details?: { reason?: string } }
}

async function* events(response: Response, signal: AbortSignal | undefined): AsyncGenerator<StreamEvent> {
  if (!response.body) throw new GatewayError('PROVIDER_UNAVAILABLE')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += value
      let at: number
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).trim()
        buffer = buffer.slice(at + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          yield JSON.parse(data) as StreamEvent
        } catch {
          throw new GatewayError('PROVIDER_UNAVAILABLE')
        }
      }
    }
  } catch (error) {
    if (error instanceof GatewayError) throw error
    throw new GatewayError(signal?.aborted ? 'CANCELLED' : 'PROVIDER_UNAVAILABLE')
  } finally {
    reader.releaseLock()
  }
}

export const openaiResponsesChat = (accessToken: string, accountId: string | null = null): ChatProvider => {
  const stream = async function* (request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatChunk> {
    const response = await send(accessToken, accountId, '/responses', { method: 'POST', body: bodyOf(request), signal })
    let model = request.model
    // Success only after `response.completed`: a stream that stops short is a failure, not a short answer.
    for await (const event of events(response, signal)) {
      if (event.type === 'response.output_text.delta' && event.delta) yield { kind: 'text', text: event.delta }
      if (event.type === 'response.failed') throw failedCode(event.response?.error?.code)
      if (event.type === 'response.incomplete' || event.type === 'response.completed') {
        model = event.response?.model ?? model
        const finish: FinishReason = event.type === 'response.completed' ? 'stop' : event.response?.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'other'
        yield { kind: 'end', finish, model, usage: { tokensIn: event.response?.usage?.input_tokens ?? 0, tokensOut: event.response?.usage?.output_tokens ?? 0 } }
        return
      }
    }
    throw new GatewayError('PROVIDER_UNAVAILABLE')
  }
  return {
    name: 'openai',
    validateCredentials: async (signal) => {
      try {
        await send(accessToken, accountId, '/models', { method: 'GET', signal })
        return 'ok'
      } catch (error) {
        return error instanceof GatewayError && error.code === 'INVALID_CREDENTIALS' ? 'rejected' : 'unavailable'
      }
    },
    listModels: async (signal) => {
      const body = (await (await send(accessToken, accountId, '/models', { method: 'GET', signal })).json()) as { models?: { slug: string; visibility?: string }[]; data?: { id: string }[] }
      return body.models ? body.models.filter((m) => m.visibility === 'list').map((m) => m.slug) : (body.data ?? []).map((m) => m.id)
    },
    generateResponse: async (request, signal): Promise<ChatAnswer> => {
      let text = ''
      for await (const chunk of stream(request, signal)) {
        if (chunk.kind === 'text') text += chunk.text
        else return { text, model: chunk.model, finish: chunk.finish, usage: chunk.usage }
      }
      throw new GatewayError('PROVIDER_UNAVAILABLE')
    },
    streamResponse: stream,
  }
}
