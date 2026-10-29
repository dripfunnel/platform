import Anthropic from '@anthropic-ai/sdk'
import { anthropicFailure, anthropicOAuthHeaders } from './anthropicChat'
import { capabilityOf, costOf } from './registry'

// The designer's model provider (THIRD-PARTY-ACCESS §2.6, §3.3): called by the Worker only, with a key the caller
// passes in, never kept, logged or sent to a container. A call has a timeout and retries with backoff.

export type AiImage = { mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; base64: string }

export interface AiCall {
  system: string
  text: string
  images: readonly AiImage[]
}

export interface AiAnswer {
  text: string
  model: string
  tokensIn: number
  tokensOut: number
  /** Minor units of costCurrency (DATA-MODEL §7.1). */
  costAmount: number
  costCurrency: string
}

export interface AiProvider {
  complete: (call: AiCall) => Promise<AiAnswer>
}

/** The model refused, or answered nothing usable: the change is refused and nothing changes. */
export class AiDeclined extends Error {
  override name = 'AiDeclined'
}

export const designerModel = 'claude-opus-5-5'
export const anthropicOAuthDesignerModel = 'claude-haiku-4-5'
/** US cents per million tokens, input and output, for the designer's model (ai_run.cost_amount). */
const centsPerMillion = { input: 400, output: 2000 } as const
const timeoutMs = 180_000

export const costCents = (tokensIn: number, tokensOut: number): number => Math.ceil((tokensIn * centsPerMillion.input + tokensOut * centsPerMillion.output) / 1_000_000)

const costFor = (model: string, tokensIn: number, tokensOut: number): number => {
  const capability = capabilityOf('anthropic', model)
  return capability ? costOf(capability, tokensIn, tokensOut) : costCents(tokensIn, tokensOut)
}

export const anthropicProvider = (apiKey: string, model: string = designerModel): AiProvider => {
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 })
  return {
    complete: async (call) => {
      const stream = client.messages.stream({
        model,
        max_tokens: capabilityOf('anthropic', model)?.maxOutputTokens ?? 64_000,
        output_config: { effort: 'high' },
        system: call.system,
        messages: [
          {
            role: 'user',
            content: [...call.images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.base64 } })), { type: 'text' as const, text: call.text }],
          },
        ],
      })
      const message = await stream.finalMessage()
      if (message.stop_reason === 'refusal') throw new AiDeclined('the model declined')
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
      const tokensIn = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0)
      const tokensOut = message.usage.output_tokens
      return { text, model: message.model, tokensIn, tokensOut, costAmount: costFor(model, tokensIn, tokensOut), costCurrency: 'USD' }
    },
  }
}

export const anthropicOAuthDesignerProvider = (authToken: string, model: string = anthropicOAuthDesignerModel): AiProvider => {
  const client = new Anthropic({ apiKey: null, authToken, defaultHeaders: anthropicOAuthHeaders, timeout: timeoutMs })
  return {
    complete: async (call) => {
      try {
        const message = await client.messages.stream({
          model,
          max_tokens: capabilityOf('anthropic', model)?.maxOutputTokens ?? 64_000,
          system: call.system,
          messages: [{
            role: 'user',
            content: [...call.images.map((image) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mediaType, data: image.base64 } })), { type: 'text' as const, text: call.text }],
          }],
        }).finalMessage()
        if (message.stop_reason === 'refusal') throw new AiDeclined('the model declined')
        const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
        return { text, model: message.model, tokensIn: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0), tokensOut: message.usage.output_tokens, costAmount: 0, costCurrency: 'USD' }
      } catch (error) {
        if (error instanceof AiDeclined) throw error
        throw anthropicFailure(error)
      }
    },
  }
}

/** The local stand-in (AI_LOCAL=1, docs/setup/local.md): answers every request with no change and says why. */
export const localAiProvider = (): AiProvider => ({
  complete: async () => ({
    text: JSON.stringify({ files: [], reply: 'This is the local stand-in for the design model, so nothing changed.', changed: [], page: null }),
    model: 'local-stand-in',
    tokensIn: 0,
    tokensOut: 0,
    costAmount: 0,
    costCurrency: 'USD',
  }),
})

export type KeyCheck = 'ok' | 'rejected' | 'unavailable'

/** One cheap call that tells a live key from a dead one (#275): a refusal of the key is `rejected`, anything else `unavailable`. */
export const checkAnthropicKey = async (apiKey: string): Promise<KeyCheck> => {
  try {
    await new Anthropic({ apiKey, timeout: 15_000, maxRetries: 0 }).models.list({ limit: 1 })
    return 'ok'
  } catch (error) {
    return error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError ? 'rejected' : 'unavailable'
  }
}
