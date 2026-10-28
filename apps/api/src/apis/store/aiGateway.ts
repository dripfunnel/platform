import { GraphQLError } from 'graphql'
import { GatewayError, gatewayProviders, modelsOf, type GatewayErrorCode } from '#integrations/ai/index'
import { chatInput, createAiGateway, GatewayRefused, maxBodyBytes, type GatewayDeps, type GatewayRefusal } from '#saas/aiGateway/index'
import type { AiOAuth } from '#saas/aiOAuth/index'
import { storePolicy, tenantCaller, type StoreContext } from './access'

// `/api/v1/*` on the portal host (docs/api/SAAS.md §9.3, #950): a store's API key runs a chat call on Claude or ChatGPT.
// Authorised by the key's `ai.run` scope through the same policy as GraphQL; the key is the actor in `ai_run`.
export const aiGatewayPath = '/api/v1'
export const isAiGatewayPath = (pathname: string): boolean => pathname === aiGatewayPath || pathname.startsWith(`${aiGatewayPath}/`)

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })
const failure = (code: string, status: number, headers: Record<string, string> = {}) => json({ error: { code } }, status, headers)

const authStatus: Record<string, number> = { UNAUTHENTICATED: 401, RATE_LIMITED: 429, STORE_SUSPENDED: 403, FORBIDDEN: 403 }
const refusalStatus: Record<GatewayRefusal, number> = { INVALID_INPUT: 400, MODEL_NOT_FOUND: 404, AI_NOT_CONNECTED: 409, AI_BUDGET_REACHED: 429, NOT_CONFIGURED: 503, AI_ACCOUNT_EXPIRED: 409, AI_ACCOUNT_UNAVAILABLE: 503 }
const errorStatus: Record<GatewayErrorCode, number> = { INVALID_CREDENTIALS: 502, RATE_LIMITED: 429, PROVIDER_UNAVAILABLE: 502, TIMEOUT: 504, CANCELLED: 499, BAD_REQUEST: 400, MODEL_NOT_FOUND: 404, CONTENT_REFUSED: 422 }

// Keys only: a signed-in person's cookie never reaches a call that spends money, so no CSRF path exists.
const authorise = async (ctx: StoreContext, name: string) => {
  if (ctx.standing.kind !== 'machine') return failure(ctx.standing.kind === 'signed-out' ? 'UNAUTHENTICATED' : 'FORBIDDEN', ctx.standing.kind === 'signed-out' ? 401 : 403)
  try {
    await storePolicy.authorize({ api: 'store', scope: 'store', permission: 'ai.run', target: 'none', machine: true }, ctx, {}, 'mutation', { name, root: true })
    return null
  } catch (error) {
    const code = error instanceof GraphQLError ? String(error.extensions['code'] ?? 'FORBIDDEN') : 'FORBIDDEN'
    return failure(code, authStatus[code] ?? 403, code === 'RATE_LIMITED' ? { 'retry-after': '60' } : {})
  }
}

export interface AiGatewayEnv {
  fallbackKey: string | undefined
  oauth?: AiOAuth | null
  /** A stand-in for the model adapters, for tests; the real ones when absent. */
  adapters?: GatewayDeps['adapters']
}

export const handleAiGateway = async (request: Request, ctx: StoreContext, env: AiGatewayEnv): Promise<Response> => {
  const path = new URL(request.url).pathname.slice(aiGatewayPath.length)
  const listing = request.method === 'GET' && (path === '/providers' || /^\/providers\/[a-z]+\/models$/.test(path))
  const chat = request.method === 'POST' && path === '/chat/completions'
  if (!listing && !chat) return failure('NOT_FOUND', request.method === 'GET' || request.method === 'POST' ? 404 : 405)
  const refused = await authorise(ctx, chat ? 'aiChat' : 'aiProviders')
  if (refused) return refused
  if (!ctx.sql) return failure('NOT_CONFIGURED', 503)
  if (listing) {
    if (path === '/providers') return json({ providers: gatewayProviders.map((id) => ({ id, models: modelsOf(id) })) })
    const provider = gatewayProviders.find((p) => p === path.split('/')[2])
    return provider ? json({ provider, models: modelsOf(provider) }) : failure('NOT_FOUND', 404)
  }
  const caller = tenantCaller(ctx)
  // The size is read before the body is parsed, so an oversized request costs nothing (AGENTS.md "Security").
  if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) return failure('INVALID_INPUT', 413)
  const raw = await request.text()
  if (raw.length > maxBodyBytes) return failure('INVALID_INPUT', 413)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return failure('INVALID_INPUT', 400)
  }
  const input = chatInput.safeParse(parsed)
  if (!input.success) return failure('INVALID_INPUT', 400)
  const gateway = createAiGateway({
    sql: ctx.sql,
    context: caller.context,
    secrets: ctx.secrets ?? null,
    fallbackKey: env.fallbackKey,
    oauth: env.oauth ?? null,
    ...(env.adapters ? { adapters: env.adapters } : {}),
    actor: { keyId: caller.actor.kind === 'api_key' ? caller.actor.id : null, userId: caller.actor.kind === 'person' ? caller.actor.id : null },
    now: ctx.now,
  })
  const checked = gateway.validate(input.data)
  if (!checked.ok) return failure(checked.reason, refusalStatus[checked.reason])
  // `request.signal` ends the provider call when the caller goes away.
  if (input.data.stream) {
    // The first chunk is read before the 200 is sent, so a refusal or a provider failure answers with its own status and code.
    const chunks = gateway.stream(input.data, request.signal)
    try {
      return streamed(chunks, await chunks.next(), input.data.provider)
    } catch (error) {
      if (error instanceof GatewayRefused) return failure(error.reason, refusalStatus[error.reason])
      const code = error instanceof GatewayError ? error.code : 'PROVIDER_UNAVAILABLE'
      return failure(code, errorStatus[code], error instanceof GatewayError && error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {})
    }
  }
  try {
    const result = await gateway.complete(input.data, request.signal)
    if ('reason' in result) return failure(result.reason, refusalStatus[result.reason])
    if ('error' in result) return failure(result.error.code, errorStatus[result.error.code], result.error.retryAfter ? { 'retry-after': String(result.error.retryAfter) } : {})
    return json({ provider: input.data.provider, model: result.answer.model, text: result.answer.text, finish: result.answer.finish, usage: result.answer.usage, billedTo: result.billed })
  } catch (error) {
    const code = error instanceof GatewayError ? error.code : 'PROVIDER_UNAVAILABLE'
    return failure(code, errorStatus[code])
  }
}

type Chunks = AsyncGenerator<import('#integrations/ai/index').ChatChunk>
const streamed = (chunks: Chunks, first: IteratorResult<import('#integrations/ai/index').ChatChunk>, provider: string): Response => {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      const emit = (chunk: import('#integrations/ai/index').ChatChunk) => send(chunk.kind, chunk.kind === 'text' ? { text: chunk.text } : { provider, model: chunk.model, finish: chunk.finish, usage: chunk.usage })
      try {
        if (!first.done) emit(first.value)
        for await (const chunk of chunks) emit(chunk)
      } catch (error) {
        send('error', { code: error instanceof GatewayError ? error.code : 'PROVIDER_UNAVAILABLE' })
      }
      controller.close()
    },
    cancel: () => void chunks.return(undefined),
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
