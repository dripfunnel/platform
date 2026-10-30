import { GatewayError } from '../gateway'
import { codeOfKind, createExecutor, field, type ExecutorOptions } from './base'

// Messages API; an OAuth connection's Bearer and beta header come from headers.ts, the one place headers are built.
export const anthropicExecutor = (options?: ExecutorOptions) =>
  createExecutor(
    {
      id: 'anthropic-messages',
      format: 'anthropic-messages',
      provider: 'anthropic',
      authTypes: ['api_key', 'oauth'],
      capabilities: { images: true, tools: true, reasoning: true, structuredOutput: false, developerRole: false, streaming: true, maxOutputTokens: 64_000 },
      url: 'https://api.anthropic.com/v1/messages',
      modelsUrl: 'https://api.anthropic.com/v1/models?limit=1',
      isTerminal: (event) => field(event, 'type') === 'message_stop',
      streamFailure: (event) => (field(event, 'type') === 'error' ? new GatewayError(codeOfKind(field(event, 'error', 'type'))) : null),
    },
    options,
  )
