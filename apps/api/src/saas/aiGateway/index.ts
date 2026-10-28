import type postgres from 'postgres'
import { z } from 'zod'
import type { SecretBox } from '#auth/secretBox'
import type { TenantContext } from '#core/tenancy'
import type { AiProvider } from '#db/schema/saas'
import { withSystemScope } from '#db/scoped/index'
import { selectDefaultAiKey } from '#db/scoped/partnerCredentials'
import { hasUsageLeft, releaseUsage, reserveUsage } from '#db/scoped/storeAccount'
import { selectSealedStoreKey } from '#db/scoped/storeAiAccount'
import { AiDeclined, anthropicChat, anthropicOAuthDesignerModel, anthropicOAuthDesignerProvider, anthropicProvider, designerModel, openaiChat, openaiResponsesChat, capabilityOf, costOf, modelsOf, GatewayError, gatewayProviders, withRetry, type AiProvider as DesignerAi, type ChatAnswer, type ChatChunk, type ChatProvider, type ChatRequest, type GatewayProvider } from '#integrations/ai/index'
import { allowanceFor } from '#saas/entitlements/index'
import type { AiOAuth } from '#saas/aiOAuth/index'
import type { AiOwner } from '#db/scoped/aiOauth'

// The AI gateway (#950; docs/api/SAAS.md §9.3): one request shape for Claude and ChatGPT, run on the partner's default key
// while the plan's allowance lasts, then on the store's own account only if its Owner turned that on. Nothing is switched
// silently, and a prompt or an answer is never stored.

export const maxMessages = 50
export const maxContentChars = 100_000
export const maxBodyBytes = 400_000
const ownKeyMode = 0
const monthStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))

const message = z.strictObject({ role: z.enum(['system', 'user', 'assistant']), content: z.string().min(1).max(maxContentChars) })

export const chatInput = z.strictObject({
  provider: z.enum(gatewayProviders),
  model: z.string().min(1).max(100),
  system: z.union([z.string().max(maxContentChars), z.array(z.strictObject({ type: z.literal('text'), text: z.string().min(1).max(maxContentChars) }))]).optional(),
  messages: z.array(message).min(1).max(maxMessages),
  temperature: z.number().finite().optional(),
  maxTokens: z.number().int().min(1).max(64_000).optional(),
  stream: z.boolean().default(false),
  /** Provider-specific parameters; the adapter refuses the ones it doesn't take. */
  options: z.record(z.string().max(40), z.unknown()).optional(),
})
export type ChatInput = z.infer<typeof chatInput>

/** A refusal before any model call, thrown by `stream` so the route can answer it with its own status, as `complete` does. */
export class GatewayRefused extends Error {
  override name = 'GatewayRefused'
  constructor(readonly reason: GatewayRefusal) {
    super(reason)
  }
}

export type GatewayRefusal = 'INVALID_INPUT' | 'MODEL_NOT_FOUND' | 'AI_NOT_CONNECTED' | 'AI_BUDGET_REACHED' | 'NOT_CONFIGURED' | 'AI_ACCOUNT_EXPIRED' | 'AI_ACCOUNT_UNAVAILABLE'

/** Who pays for a run: the partner's key on the plan, or the store's own account. */
export type Billed = 'plan' | 'own_key'
export type AuthMethod = 'api_key' | 'oauth'

export interface GatewayDeps {
  sql: postgres.Sql
  context: TenantContext
  secrets: SecretBox | null
  /** The Worker's `AI_PROVIDER_KEY`, used only for a partner with no key at all (THIRD-PARTY-ACCESS §2.6). */
  fallbackKey: string | undefined
  actor: { keyId: string | null; userId: string | null }
  /** The sign-in flow, which renews a signed-in account's token; null where the Worker has none. */
  oauth?: AiOAuth | null
  /** Builds the adapter for a key or a sign-in's token; the real ones by default, a stand-in in tests. */
  adapters?: (provider: GatewayProvider, key: string, auth: AuthMethod, accountId: string | null) => ChatProvider
  now: () => Date
  sleep?: (ms: number) => Promise<void>
}

const realAdapters = (provider: GatewayProvider, key: string, auth: AuthMethod, accountId: string | null): ChatProvider => {
  if (auth === 'oauth') return provider === 'anthropic' ? anthropicChat({ authToken: key }) : openaiResponsesChat(key, accountId)
  return provider === 'anthropic' ? anthropicChat(key) : openaiChat(key)
}

type Credential = { provider: AiProvider; key: string; auth: AuthMethod; accountId?: string | null }
type Unusable = 'EXPIRED' | 'UNAVAILABLE'

interface Resolved {
  provider: ChatProvider
  billed: Billed
  /** The key's own provider: the call goes there whatever the request asked, or is refused. */
  keyProvider: AiProvider
  auth: AuthMethod
}

export const createAiGateway = ({ sql, context, secrets, fallbackKey, actor, oauth = null, adapters = realAdapters, now, sleep }: GatewayDeps) => {
  const { storeId, partnerId } = context

  const allowance = async (): Promise<{ allowed: number; mode: number }> => ({ allowed: await allowanceFor(sql, context, 'ai_prompts', now()), mode: await allowanceFor(sql, context, 'ai_mode', now()) })

  const planLeft = (allowed: number) => withSystemScope(sql, (tx) => hasUsageLeft(tx, storeId, 'ai_prompts', monthStart(now()), allowed))

  /** The partner's default account, else (a partner with none at all) the Worker's key; a default that can't be used answers null. */
  const planKey = async (allowSignIn: boolean): Promise<Credential | { unusable: Unusable } | null> => {
    const row = await withSystemScope(sql, (tx) => selectDefaultAiKey(tx, partnerId))
    if (!row) return fallbackKey ? { provider: 'anthropic', key: fallbackKey, auth: 'api_key' } : null
    if (row.status === 'rejected') return row.auth_type === 'oauth' && allowSignIn ? { unusable: 'EXPIRED' } : null
    if (!secrets) return null
    // A partner's sign-in is one person's subscription: the studio may use it, `/api/v1` never (THIRD-PARTY-ACCESS §2.6).
    if (row.auth_type === 'oauth') return allowSignIn ? signedIn({ kind: 'partner', id: partnerId, partnerId }, row.id) : null
    const key = await secrets.open(row.key_enc)
    return key ? { provider: row.provider, key, auth: 'api_key' } : null
  }

  /** A signed-in account's current token, renewed if due; the account the provider refuses answers EXPIRED. */
  const signedIn = async (owner: AiOwner, credentialId: string | null): Promise<Credential | { unusable: Unusable } | null> => {
    const token = await oauth?.accessToken(owner, credentialId)
    if (!token) return null
    if (token.ok) return { provider: token.provider, key: token.token, auth: 'oauth', accountId: token.accountId }
    // A sign-in whose token can't be read or renewed is the account's, not "nothing connected".
    return token.reason === 'EXPIRED' ? { unusable: 'EXPIRED' } : token.reason === 'NOT_FOUND' ? null : { unusable: 'UNAVAILABLE' }
  }

  const ownKey = async (requireSwitch: boolean, allowSignIn: boolean): Promise<Credential | { unusable: Unusable } | null> => {
    const row = await withSystemScope(sql, (tx) => selectSealedStoreKey(tx, storeId))
    if (!row || !secrets || (requireSwitch && !row.use_when_plan_used)) return null
    // The same rule as a partner's: a sign-in is one person's subscription, for the studio and never `/api/v1`.
    if (row.auth_type === 'oauth') return !allowSignIn ? null : row.status === 'rejected' ? { unusable: 'EXPIRED' } : signedIn({ kind: 'store', id: storeId, partnerId }, null)
    if (row.status === 'rejected') return null
    const key = await secrets.open(row.key_enc)
    return key ? { provider: row.provider, key, auth: 'api_key' } : null
  }

  /**
   * Whose key runs this request. A plan on `ownKey` always uses the store's account. Otherwise the partner's key while the
   * allowance lasts; once it is used up, the store's own account only when its Owner switched that on.
   */
  type Resolution = { ok: true; resolved: Omit<Resolved, 'provider'> & { key: string; accountId: string | null } } | { ok: false; reason: GatewayRefusal }
  const refusalOf = (u: Unusable): GatewayRefusal => (u === 'EXPIRED' ? 'AI_ACCOUNT_EXPIRED' : 'AI_ACCOUNT_UNAVAILABLE')
  const resolvedOf = (billed: Billed, c: Credential | { unusable: Unusable } | null, none: GatewayRefusal): Resolution => {
    if (!c) return { ok: false, reason: none }
    if ('unusable' in c) return { ok: false, reason: refusalOf(c.unusable) }
    return { ok: true, resolved: { billed, key: c.key, keyProvider: c.provider, auth: c.auth, accountId: c.accountId ?? null } }
  }

  const resolve = async (): Promise<Resolution> => {
    const { allowed, mode } = await allowance()
    if (mode === ownKeyMode) return resolvedOf('own_key', await ownKey(false, false), 'AI_NOT_CONNECTED')
    if (await planLeft(allowed)) return resolvedOf('plan', await planKey(false), 'AI_NOT_CONNECTED')
    return resolvedOf('own_key', await ownKey(true, false), 'AI_BUDGET_REACHED')
  }

  const reserve = async (): Promise<boolean> => {
    const { allowed } = await allowance()
    return withSystemScope(sql, (tx) => reserveUsage(tx, storeId, 'ai_prompts', monthStart(now()), allowed, now()))
  }
  const giveBack = () => withSystemScope(sql, (tx) => releaseUsage(tx, storeId, 'ai_prompts', monthStart(now()), now()))

  const record = (input: ChatInput, billed: Billed, auth: AuthMethod, answer: { model: string; tokensIn: number; tokensOut: number } | null, cost: number, outcome: 'changed' | 'failed') =>
    withSystemScope(sql, async (tx) => {
      await tx`
        insert into ai_run (store_id, kind, requested_by, prompt, model, tokens_in, tokens_out, cost_amount, cost_currency, billed_to, outcome, api_key_id, provider, auth_method)
        values (${storeId}, 'gateway', ${actor.userId}, '', ${answer?.model ?? input.model}, ${answer?.tokensIn ?? 0}, ${answer?.tokensOut ?? 0}, ${cost}, 'USD', ${billed}, ${outcome}, ${actor.keyId}, ${input.provider}, ${auth})`
    })

  /** A sign-in's runs are paid from the person's own plan at the provider, so no money moves through us and none is recorded. */
  const costIn = (auth: AuthMethod, model: Parameters<typeof costOf>[0], usage: { tokensIn: number; tokensOut: number }) => (auth === 'oauth' ? 0 : costOf(model, usage.tokensIn, usage.tokensOut))

  const requestOf = (input: ChatInput): ChatRequest => ({
    model: input.model,
    ...(input.system !== undefined ? { system: input.system } : {}),
    messages: input.messages,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    maxTokens: input.maxTokens ?? capabilityOf(input.provider, input.model)?.maxOutputTokens ?? 64_000,
    ...(input.options !== undefined ? { options: input.options } : {}),
  })

  /** Checks the request against the model's capabilities before any provider or budget is touched. */
  const validate = (input: ChatInput) => {
    const model = capabilityOf(input.provider, input.model)
    if (!model) return { ok: false as const, reason: 'MODEL_NOT_FOUND' as const }
    const [low, high] = model.temperature
    if (!input.messages.some((m) => m.role === 'user')) return { ok: false as const, reason: 'INVALID_INPUT' as const }
    if ((input.maxTokens ?? 0) > model.maxOutputTokens || (input.temperature !== undefined && (input.temperature < low || input.temperature > high))) return { ok: false as const, reason: 'INVALID_INPUT' as const }
    return { ok: true as const, model }
  }

  const retry = (signal: AbortSignal | undefined) => ({ attempts: 3, baseMs: 500, maxMs: 8_000, ...(signal ? { signal } : {}), ...(sleep ? { sleep } : {}) })

  /** Runs `input` to its answer. The plan's prompt is taken before the call and given back if the model was never reached. */
  const complete = async (input: ChatInput, signal?: AbortSignal): Promise<{ ok: true; answer: ChatAnswer; billed: Billed } | { ok: false; reason: GatewayRefusal } | { ok: false; error: GatewayError }> => {
    const checked = validate(input)
    if (!checked.ok) return checked
    const who = await resolve()
    if (!who.ok) return who
    const { billed, key, keyProvider, auth, accountId } = who.resolved
    // A key reaches only its own provider's models: asking for another's is a model it doesn't have.
    if (keyProvider !== input.provider) return { ok: false, reason: 'MODEL_NOT_FOUND' }
    if (billed === 'plan' && !(await reserve())) return { ok: false, reason: 'AI_BUDGET_REACHED' }
    let reached = false
    try {
      const adapter = adapters(input.provider, key, auth, accountId)
      const answer = await withRetry(() => ((reached = true), adapter.generateResponse(requestOf(input), signal)), retry(signal))
      await record(input, billed, auth, { model: answer.model, ...answer.usage }, costIn(auth, checked.model, answer.usage), 'changed')
      return { ok: true, answer, billed }
    } catch (error) {
      const failure = error instanceof GatewayError ? error : new GatewayError('PROVIDER_UNAVAILABLE')
      // The provider refusing a sign-in's token means the person must sign in again, not that DripFunnel failed.
      const expired = auth === 'oauth' && failure.code === 'INVALID_CREDENTIALS'
      if (billed === 'plan') await giveBack()
      await record(input, billed, auth, null, 0, 'failed')
      if (!reached) throw error
      return expired ? { ok: false, reason: 'AI_ACCOUNT_EXPIRED' } : { ok: false, error: failure }
    }
  }

  /** The same, as a stream; the run is recorded when the stream ends or fails. */
  const stream = async function* (input: ChatInput, signal?: AbortSignal): AsyncGenerator<ChatChunk> {
    const checked = validate(input)
    if (!checked.ok) throw new GatewayRefused(checked.reason)
    const who = await resolve()
    if (!who.ok) throw new GatewayRefused(who.reason)
    if (who.resolved.keyProvider !== input.provider) throw new GatewayRefused('MODEL_NOT_FOUND')
    const { billed, key, auth, accountId } = who.resolved
    if (billed === 'plan' && !(await reserve())) throw new GatewayRefused('AI_BUDGET_REACHED')
    let ended = false
    let sent = false
    try {
      for await (const chunk of adapters(input.provider, key, auth, accountId).streamResponse(requestOf(input), signal)) {
        if (chunk.kind === 'end') {
          ended = true
          await record(input, billed, auth, { model: chunk.model, ...chunk.usage }, costIn(auth, checked.model, chunk.usage), 'changed')
        }
        if (chunk.kind === 'text') sent = true
        yield chunk
      }
    } finally {
      if (!ended) {
        // Text already sent is the caller's: the prompt is given back only when nothing reached them.
        if (billed === 'plan' && !sent) await giveBack()
        await record(input, billed, auth, null, 0, 'failed')
      }
    }
  }

  /** The account that pays for `billed`, with no allowance check: the studio takes its own unit (SAAS §9.2). */
  const credential = (billed: Billed) => (billed === 'plan' ? planKey(true) : ownKey(false, true))

  return { validate, complete, stream, resolve, credential }
}

export type AiGateway = ReturnType<typeof createAiGateway>

const openaiDesignerModel = 'gpt-5'

type DesignerDeps = Omit<GatewayDeps, 'actor' | 'now'>

const credentialFor = async (deps: DesignerDeps, billed: Billed) => {
  const found = await createAiGateway({ ...deps, actor: { keyId: null, userId: null }, now: () => new Date() }).credential(billed)
  return !found || 'unusable' in found ? null : found
}

/** The studio's models on the account that pays, the default first; none when no account can be used. */
export const designerModelsFor = async (deps: DesignerDeps, billed: Billed): Promise<readonly string[]> => {
  const found = await credentialFor(deps, billed)
  if (found?.provider === 'anthropic' && found.auth === 'oauth') return [anthropicOAuthDesignerModel, ...modelsOf('anthropic').filter((model) => model !== anthropicOAuthDesignerModel)]
  return found ? modelsOf(found.provider) : []
}

/**
 * The studio's model on the account that pays (#950): a Claude API key as before; a sign-in or a ChatGPT key through the chat
 * adapters, text only, so a pasted image is declined there. `model` is one of `designerModelsFor`; nothing usable answers null.
 */
export const designerAiFor = async (deps: DesignerDeps, billed: Billed, requested: string | null = null): Promise<DesignerAi | null> => {
  const found = await credentialFor(deps, billed)
  if (!found) return null
  const anthropicOAuth = found.provider === 'anthropic' && found.auth === 'oauth'
  const model = requested ?? (anthropicOAuth ? anthropicOAuthDesignerModel : found.provider === 'anthropic' ? designerModel : openaiDesignerModel)
  const capability = capabilityOf(found.provider, model)
  if (anthropicOAuth) return capability ? anthropicOAuthDesignerProvider(found.key, model) : null
  if (!capability) return null
  if (found.provider === 'anthropic' && found.auth === 'api_key') return anthropicProvider(found.key, model)
  const chat = (deps.adapters ?? realAdapters)(found.provider, found.key, found.auth, found.accountId ?? null)
  return {
    complete: async (call) => {
      if (call.images.length > 0) throw new AiDeclined('images need an API key')
      let text = ''
      let end: Extract<ChatChunk, { kind: 'end' }> | null = null
      for await (const chunk of chat.streamResponse({ model, system: call.system, messages: [{ role: 'user', content: call.text }], maxTokens: capability.maxOutputTokens })) {
        if (chunk.kind === 'text') text += chunk.text
        else end = chunk
      }
      if (!end || end.finish === 'refusal') throw new AiDeclined('the model declined')
      return { text, model: end.model, tokensIn: end.usage.tokensIn, tokensOut: end.usage.tokensOut, costAmount: found.auth === 'oauth' ? 0 : costOf(capability, end.usage.tokensIn, end.usage.tokensOut), costCurrency: 'USD' }
    },
  }
}
