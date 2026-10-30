import Anthropic from '@anthropic-ai/sdk'
import { anthropicFailure, anthropicOAuthHeaders } from './anthropicChat'
import { UnsupportedFeature, type CanonicalMessage, type CanonicalRequest, type CanonicalTool, type CanonicalToolCall } from './canonical'
import { GatewayError } from './gateway'
import { capabilityOf, costOf } from './registry'
import { collectStream, type Router } from './routing/router'
import type { Routed } from './routing/types'

// The designer's model provider (THIRD-PARTY-ACCESS §2.6, §3.3): called by the Worker only, with a key the caller
// passes in, never kept, logged or sent to a container. A call has a timeout; every failure is a `GatewayError`, and
// `designerAiFor` is the one place that retries (SAAS.md §9.3).

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

/** One turn of a conversation that may call tools; the caller runs the tools and sends their results back (AI-STUDIO §4). */
export interface AiTurn extends AiAnswer {
  toolCalls: readonly CanonicalToolCall[]
  /** True when the model stopped to call a tool rather than to answer. */
  wantsTools: boolean
}

export interface AiProvider {
  complete: (call: AiCall) => Promise<AiAnswer>
  /** Only a provider that reaches the router carries tools; without it the designer makes its one call and no more. */
  converse?: (call: { system: string; messages: readonly CanonicalMessage[]; tools: readonly CanonicalTool[]; signal?: AbortSignal }) => Promise<AiTurn>
}

/** The model refused, or answered nothing usable: the change is refused and nothing changes. */
export class AiDeclined extends Error {
  override name = 'AiDeclined'
}

/** The provider refused a sign-in's token: the person must sign in again, which is not the same as a key DripFunnel holds being refused. */
export class SignInExpired extends GatewayError {
  override name = 'SignInExpired'
  constructor() {
    super('INVALID_CREDENTIALS')
  }
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
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 })
  return {
    complete: async (call) => {
      try {
        const message = await client.messages
          .stream({
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
          .finalMessage()
        if (message.stop_reason === 'refusal') throw new AiDeclined('the model declined')
        const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
        const tokensIn = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0)
        const tokensOut = message.usage.output_tokens
        return { text, model: message.model, tokensIn, tokensOut, costAmount: costFor(model, tokensIn, tokensOut), costCurrency: 'USD' }
      } catch (error) {
        if (error instanceof AiDeclined) throw error
        throw anthropicFailure(error)
      }
    },
  }
}

/**
 * The designer's call through the router (SAAS.md §9.3): the router owns the one retry loop and any authorised fallback. The
 * answer is whole or the call fails: a refusal, a cut-off or an error event never returns text the studio could apply.
 */
export const routedDesignerProvider = (router: Router, model: string, options: { signIn: boolean; onRouted?: (routed: Pick<Routed<unknown>, 'route' | 'fallbackUsed' | 'fallbackFrom'>) => void }): AiProvider => ({
  converse: async (call) => {
    const request: CanonicalRequest = { model, system: call.system, maxTokens: 64_000, messages: call.messages, tools: call.tools, toolChoice: 'auto' }
    try {
      const routed = await router.stream(request, call.signal)
      options.onRouted?.(routed)
      const answer = await collectStream(routed.value)
      const wantsTools = answer.finish === 'tool_use' && answer.toolCalls.length > 0
      if (!wantsTools && answer.finish !== 'stop') throw new AiDeclined(answer.finish === 'refusal' ? 'the model declined' : 'the answer was cut short')
      const { route } = routed
      const capability = capabilityOf(route.provider, route.model)
      const free = route.connection.authType === 'oauth' || !capability
      return { text: answer.text, model: answer.model, tokensIn: answer.usage.tokensIn, tokensOut: answer.usage.tokensOut, costAmount: free ? 0 : costOf(capability, answer.usage.tokensIn, answer.usage.tokensOut), costCurrency: 'USD', toolCalls: answer.toolCalls, wantsTools }
    } catch (error) {
      if (error instanceof UnsupportedFeature) throw new AiDeclined(error.message)
      if (error instanceof GatewayError && error.code === 'INVALID_CREDENTIALS' && options.signIn) throw new SignInExpired()
      throw error
    }
  },
  complete: async (call) => {
    const request: CanonicalRequest = {
      model,
      system: call.system,
      maxTokens: 64_000,
      messages: [{ role: 'user', content: [...call.images.map((i) => ({ type: 'image' as const, mediaType: i.mediaType, base64: i.base64 })), { type: 'text' as const, text: call.text }] }],
    }
    try {
      const routed = await router.stream(request)
      options.onRouted?.(routed)
      const answer = await collectStream(routed.value)
      if (answer.finish !== 'stop') throw new AiDeclined(answer.finish === 'refusal' ? 'the model declined' : 'the answer was cut short')
      const { route } = routed
      const capability = capabilityOf(route.provider, route.model)
      const free = route.connection.authType === 'oauth' || !capability
      return { text: answer.text, model: answer.model, tokensIn: answer.usage.tokensIn, tokensOut: answer.usage.tokensOut, costAmount: free ? 0 : costOf(capability, answer.usage.tokensIn, answer.usage.tokensOut), costCurrency: 'USD' }
    } catch (error) {
      if (error instanceof UnsupportedFeature) throw new AiDeclined(error.message)
      if (error instanceof GatewayError && error.code === 'INVALID_CREDENTIALS' && options.signIn) throw new SignInExpired()
      throw error
    }
  },
})

export const anthropicOAuthDesignerProvider = (authToken: string, model: string = anthropicOAuthDesignerModel): AiProvider => {
  const client = new Anthropic({ apiKey: null, authToken, defaultHeaders: anthropicOAuthHeaders, timeout: timeoutMs, maxRetries: 0 })
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
