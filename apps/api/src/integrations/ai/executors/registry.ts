import type { GatewayProvider } from '../gateway'
import type { FormatId } from '../translators/types'
import { anthropicExecutor } from './anthropic'
import type { ExecutorOptions } from './base'
import { openaiExecutor } from './openai'
import { openaiResponsesExecutor } from './openai-responses'
import type { Executor, ResolvedConnection } from './types'

export class NoExecutorError extends Error {
  override name = 'NoExecutorError'
  constructor(provider: GatewayProvider, authType: ResolvedConnection['authType'], format: FormatId) {
    super(`no executor for ${provider} ${authType} ${format}`)
  }
}

const defaultFormat: Record<GatewayProvider, FormatId> = { anthropic: 'anthropic-messages', openai: 'openai-chat' }

/** The ChatGPT sign-in is not here: its endpoint is oauth/openaiResponses.ts's, so that pair is refused, not guessed. */
export const executorFor = (connection: Pick<ResolvedConnection, 'provider' | 'authType'>, options?: ExecutorOptions, format: FormatId = defaultFormat[connection.provider]): Executor => {
  const { provider, authType } = connection
  if (provider === 'anthropic' && format === 'anthropic-messages') return anthropicExecutor(options)
  if (provider === 'openai' && authType === 'api_key' && format === 'openai-chat') return openaiExecutor(options)
  if (provider === 'openai' && authType === 'api_key' && format === 'openai-responses') return openaiResponsesExecutor(options)
  throw new NoExecutorError(provider, authType, format)
}
