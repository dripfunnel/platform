import Anthropic from '@anthropic-ai/sdk'
import { anthropicFailure, anthropicOAuthHeaders } from './anthropicChat'
import { UnsupportedFeature, type CanonicalMessage, type CanonicalRequest, type CanonicalResponse, type CanonicalStreamEvent, type CanonicalTool, type CanonicalToolCall } from './canonical'
import { GatewayError } from './gateway'
import { capabilityOf, costOf, type ModelCapability } from './registry'
import { collectStream, type Router } from './routing/router'
import type { Routed } from './routing/types'

// The designer's model provider (THIRD-PARTY-ACCESS §2.6, §3.3): called by the Worker only, with a key the caller
// passes in, never kept, logged or sent to a container. A call has a timeout; every failure is a `GatewayError`, and
// `designerAiFor` is the one place that retries (SAAS.md §9.3).

export type AiImage = { mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; base64: string }

export interface AiCall {
  system: string
  /** Stable text sent first, before the images and `text`; `system` and each part end a cached prefix (SAAS.md §9.3). */
  context?: readonly string[]
  text: string
  images: readonly AiImage[]
  /** Each piece of the answer's text as it streams through the router (studio chat mode, AI-STUDIO §4); the answer still comes whole. */
  onText?: (text: string) => void
}

export interface AiAnswer {
  text: string
  model: string
  tokensIn: number
  tokensOut: number
  /** Minor units of costCurrency (DATA-MODEL §7.1). */
  costAmount: number
  costCurrency: string
  /** The part of tokensIn read from the provider's prompt cache. */
  tokensCached?: number
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
  converse?: (call: { system: string; cacheSystem?: boolean; messages: readonly CanonicalMessage[]; tools: readonly CanonicalTool[]; toolChoice?: 'auto' | 'none'; signal?: AbortSignal }) => Promise<AiTurn>
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

const costFor = (model: string, tokensIn: number, tokensOut: number, cache: { read: number; write: number }): number => {
  const capability = capabilityOf('anthropic', model)
  return capability ? costOf(capability, tokensIn, tokensOut, cache) : costCents(tokensIn, tokensOut)
}

/** An AiCall as Messages API blocks: the cache markers go on `system` and each context part when there is context. */
const messagesOf = (call: AiCall) => {
  const cached = (call.context?.length ?? 0) > 0
  const marker = { cache_control: { type: 'ephemeral' as const } }
  return {
    system: cached ? [{ type: 'text' as const, text: call.system, ...marker }] : call.system,
    messages: [
      {
        role: 'user' as const,
        content: [
          ...(call.context ?? []).map((text) => ({ type: 'text' as const, text, ...marker })),
          ...call.images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.base64 } })),
          { type: 'text' as const, text: call.text },
        ],
      },
    ],
  }
}

type SdkUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }

/** Cached input counts in tokensIn too, each part priced at its own rate (registry.ts). */
const sdkUsage = (usage: SdkUsage) => {
  const cache = { read: usage.cache_read_input_tokens ?? 0, write: usage.cache_creation_input_tokens ?? 0 }
  return { tokensIn: usage.input_tokens + cache.read + cache.write, tokensOut: usage.output_tokens, cache }
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
            ...messagesOf(call),
          })
          .finalMessage()
        if (message.stop_reason === 'refusal') throw new AiDeclined('the model declined')
        const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
        const { tokensIn, tokensOut, cache } = sdkUsage(message.usage)
        return { text, model: message.model, tokensIn, tokensOut, costAmount: costFor(model, tokensIn, tokensOut, cache), costCurrency: 'USD', tokensCached: cache.read }
      } catch (error) {
        if (error instanceof AiDeclined) throw error
        throw anthropicFailure(error)
      }
    },
  }
}

async function* tapText(events: AsyncIterable<CanonicalStreamEvent>, onText: (text: string) => void): AsyncGenerator<CanonicalStreamEvent> {
  for await (const event of events) {
    if (event.kind === 'text') onText(event.text)
    yield event
  }
}

/** A routed answer's tokens and cost; a sign-in or an unlisted model costs nothing here (`capability` null). */
const metered = (answer: CanonicalResponse, capability: ModelCapability | null): AiAnswer => {
  const { tokensIn, tokensOut, cachedTokensIn, cacheWriteTokensIn } = answer.usage
  const costAmount = capability ? costOf(capability, tokensIn, tokensOut, { read: cachedTokensIn, write: cacheWriteTokensIn }) : 0
  return { text: answer.text, model: answer.model, tokensIn, tokensOut, costAmount, costCurrency: 'USD', tokensCached: cachedTokensIn }
}

/**
 * The designer's call through the router (SAAS.md §9.3): the router owns the one retry loop and any authorised fallback. The
 * answer is whole or the call fails: a refusal, a cut-off or an error event never returns text the studio could apply.
 */
export const routedDesignerProvider = (router: Router, model: string, options: { signIn: boolean; onRouted?: (routed: Pick<Routed<unknown>, 'route' | 'fallbackUsed' | 'fallbackFrom'>) => void }): AiProvider => ({
  converse: async (call) => {
    const request: CanonicalRequest = { model, system: call.system, ...(call.cacheSystem ? { cacheSystem: true } : {}), maxTokens: 64_000, messages: call.messages, tools: call.tools, ...(call.tools.length > 0 ? { toolChoice: call.toolChoice ?? ('auto' as const) } : {}) }
    try {
      const routed = await router.stream(request, call.signal)
      options.onRouted?.(routed)
      const answer = await collectStream(routed.value)
      const wantsTools = answer.finish === 'tool_use' && answer.toolCalls.length > 0
      if (!wantsTools && answer.finish !== 'stop') throw new AiDeclined(answer.finish === 'refusal' ? 'the model declined' : 'the answer was cut short')
      const { route } = routed
      const capability = route.connection.authType === 'oauth' ? null : capabilityOf(route.provider, route.model)
      return { ...metered(answer, capability), toolCalls: answer.toolCalls, wantsTools }
    } catch (error) {
      if (error instanceof UnsupportedFeature) throw new AiDeclined(error.message)
      if (error instanceof GatewayError && error.code === 'INVALID_CREDENTIALS' && options.signIn) throw new SignInExpired()
      throw error
    }
  },
  complete: async (call) => {
    const context = call.context ?? []
    const request: CanonicalRequest = {
      model,
      system: call.system,
      ...(context.length > 0 ? { cacheSystem: true } : {}),
      maxTokens: 64_000,
      messages: [{ role: 'user', content: [...context.map((text) => ({ type: 'text' as const, text, cache: true })), ...call.images.map((i) => ({ type: 'image' as const, mediaType: i.mediaType, base64: i.base64 })), { type: 'text' as const, text: call.text }] }],
    }
    try {
      const routed = await router.stream(request)
      options.onRouted?.(routed)
      const answer = await collectStream(call.onText ? tapText(routed.value, call.onText) : routed.value)
      if (answer.finish !== 'stop') throw new AiDeclined(answer.finish === 'refusal' ? 'the model declined' : 'the answer was cut short')
      const { route } = routed
      const capability = route.connection.authType === 'oauth' ? null : capabilityOf(route.provider, route.model)
      return metered(answer, capability)
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
          ...messagesOf(call),
        }).finalMessage()
        if (message.stop_reason === 'refusal') throw new AiDeclined('the model declined')
        const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
        const { tokensIn, tokensOut, cache } = sdkUsage(message.usage)
        return { text, model: message.model, tokensIn, tokensOut, costAmount: 0, costCurrency: 'USD', tokensCached: cache.read }
      } catch (error) {
        if (error instanceof AiDeclined) throw error
        throw anthropicFailure(error)
      }
    },
  }
}

/** The local stand-in (AI_LOCAL=1, docs/setup/local.md): answers every request with no change and says why. */
export const localAiProvider = (): AiProvider => ({
  complete: async (call) => {
    const reply = 'This is the local stand-in for the design model, so nothing changed.'
    for (const word of reply.split(/(?<= )/)) call.onText?.(word)
    const text = JSON.stringify({ files: [], reply, changed: [], page: null })
    return { text, model: 'local-stand-in', tokensIn: 0, tokensOut: 0, costAmount: 0, costCurrency: 'USD' }
  },
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
