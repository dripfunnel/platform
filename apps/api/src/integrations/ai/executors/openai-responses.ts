import { GatewayError } from '../gateway'
import { codeOfKind, createExecutor, field, type ExecutorOptions } from './base'

// Responses API with an API key. The ChatGPT sign-in's own endpoint stays in oauth/openaiResponses.ts.
const terminal: ReadonlySet<unknown> = new Set(['response.completed', 'response.incomplete'])

export const openaiResponsesExecutor = (options?: ExecutorOptions) =>
  createExecutor(
    {
      id: 'openai-responses',
      format: 'openai-responses',
      provider: 'openai',
      authTypes: ['api_key'],
      capabilities: { images: true, tools: true, reasoning: true, structuredOutput: true, developerRole: true, streaming: true, maxOutputTokens: 32_000 },
      url: 'https://api.openai.com/v1/responses',
      modelsUrl: 'https://api.openai.com/v1/models',
      isTerminal: (event) => terminal.has(field(event, 'type')),
      streamFailure: (event) => {
        const type = field(event, 'type')
        if (type === 'error') return new GatewayError(codeOfKind(field(event, 'code')))
        return type === 'response.failed' ? new GatewayError(codeOfKind(field(event, 'response', 'error', 'code'))) : null
      },
    },
    options,
  )
