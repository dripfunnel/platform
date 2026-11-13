import { GatewayError } from '../gateway'
import { codeOfKind, createExecutor, field, type ExecutorOptions } from './base'

// Chat Completions with an API key; the stream is complete only at its `[DONE]`.
export const openaiExecutor = (options?: ExecutorOptions, endpoint = 'https://api.openai.com/v1') =>
  createExecutor(
    {
      id: 'openai-chat',
      format: 'openai-chat',
      provider: 'openai',
      authTypes: ['api_key'],
      capabilities: { images: true, tools: true, reasoning: true, structuredOutput: true, developerRole: true, streaming: true, maxOutputTokens: 32_000 },
      url: `${endpoint}/chat/completions`,
      modelsUrl: `${endpoint}/models`,
      isTerminal: () => false,
      streamFailure: (event) => (field(event, 'error') ? new GatewayError(codeOfKind(field(event, 'error', 'type') ?? field(event, 'error', 'code'))) : null),
    },
    options,
  )
