import { UnsupportedFeature, type CanonicalRequest } from '../canonical'
import type { Executor, ResolvedConnection } from '../executors/types'
import type { ChatAnswer, ChatChunk, ChatProvider, ChatRequest } from '../gateway'
import { checkRequest } from '../translators/shared'
import { guardedStream, usageOf } from '../translators/streams'
import type { RequestTranslator, ResponseTranslator, StreamTranslatorFactory } from '../translators/types'
import type { Route } from './types'

// The ChatGPT sign-in keeps its own endpoint and body (oauth/openaiResponses.ts, THIRD-PARTY-ACCESS §2.6), which no shared
// executor may reach; this wraps that adapter as a route so the router's retry, cooldown and error handling apply to it too.
// It takes text only, so an image is refused as UnsupportedFeature rather than dropped.
const capabilities = { images: false, tools: false, reasoning: false, structuredOutput: false, developerRole: false, streaming: true, maxOutputTokens: 32_000 }

const request: RequestTranslator<ChatRequest> = {
  id: 'canonical->chatgpt-signin',
  from: 'canonical',
  to: 'openai-responses',
  translate: (canonical: CanonicalRequest) => {
    checkRequest(canonical, capabilities)
    const messages = canonical.messages.map((message) => {
      if (message.role === 'tool' || message.content.some((part) => part.type !== 'text')) throw new UnsupportedFeature('anything but text')
      return { role: message.role, content: message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('') }
    })
    return { model: canonical.model, ...(canonical.system ? { system: canonical.system } : {}), messages, maxTokens: canonical.maxTokens }
  },
}

const response: ResponseTranslator<ChatAnswer> = {
  from: 'openai-responses',
  parse: (answer) => ({ text: answer.text, toolCalls: [], finish: answer.finish, usage: usageOf(answer.usage.tokensIn, answer.usage.tokensOut, 0), model: answer.model }),
}

const stream: StreamTranslatorFactory<ChatChunk> = {
  from: 'openai-responses',
  create: () => {
    const guarded = guardedStream((raw) => {
      const chunk = raw as ChatChunk
      return chunk.kind === 'text' ? [{ kind: 'text', text: chunk.text }] : [{ kind: 'usage', usage: usageOf(chunk.usage.tokensIn, chunk.usage.tokensOut, 0) }, { kind: 'end', finish: chunk.finish, model: chunk.model }]
    })
    return guarded
  },
}

export const chatgptSignInRoute = (connection: ResolvedConnection, model: string, chat: ChatProvider): Route => {
  const executor: Executor = {
    id: 'chatgpt-signin',
    format: 'openai-responses',
    capabilities,
    execute: (prepared, _connection, signal) => chat.generateResponse(prepared.body as ChatRequest, signal),
    stream: (prepared, _connection, signal) => chat.streamResponse(prepared.body as ChatRequest, signal),
    validate: (_connection, signal) => chat.validateCredentials(signal),
  }
  return { provider: 'openai', model, connection, executor, requestTranslator: request as RequestTranslator<unknown>, responseTranslator: response as ResponseTranslator<unknown>, streamTranslator: stream as StreamTranslatorFactory<unknown> }
}
