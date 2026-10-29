import { UnsupportedFeature, type CanonicalRequest, type CanonicalResponse, type CanonicalStreamEvent, type ReasoningEffort } from '../canonical'
import { executorFor } from '../executors/registry'
import type { ExecutorOptions } from '../executors/base'
import type { ResolvedConnection } from '../executors/types'
import { GatewayError, transientCodes } from '../gateway'
import { capabilityOf } from '../registry'
import { withRetry } from '../retry'
import { defaultTranslators, translatorsFor } from '../translators/registry'
import type { TranslatorRegistry } from '../translators/types'
import type { CooldownStore, Route, Routed, RoutingPolicy } from './types'

// Picks the route for one call and owns its only retry loop (docs/api/SAAS.md §9.3): executors and SDK clients do not retry.
// A fallback is only ever a route the caller passed in, which the store authorised; no credential is rotated to dodge a limit.

export interface RouteOptions {
  executor?: ExecutorOptions
  reasoningEffort?: ReasoningEffort
  registry?: TranslatorRegistry
}

/** The route for a connection: its executor and its format's translators. Throws NoExecutorError for a pair with no executor. */
export const buildRoute = (connection: ResolvedConnection, model: string, { executor: executorOptions, reasoningEffort, registry = defaultTranslators() }: RouteOptions = {}): Route => {
  const executor = executorFor(connection, executorOptions)
  const { request, response, stream } = translatorsFor(registry, executor.format)
  return { provider: connection.provider, model, connection, executor, requestTranslator: request, responseTranslator: response, streamTranslator: stream, ...(reasoningEffort ? { reasoningEffort } : {}) }
}

export interface RouterDeps {
  cooldown?: CooldownStore
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
}

/** The route's model and effort win over the request's, and the answer may be as long as that model allows (never more). */
const bodyOf = (route: Route, request: CanonicalRequest): object => {
  const limit = Math.min(capabilityOf(route.provider, route.model)?.maxOutputTokens ?? Infinity, route.executor.capabilities.maxOutputTokens)
  const body = route.requestTranslator.translate({ ...request, model: route.model, maxTokens: Math.min(request.maxTokens, limit), ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}) }, route.executor.capabilities)
  if (typeof body !== 'object' || body === null) throw new GatewayError('BAD_REQUEST')
  return body
}

/** The stream flag is the router's, not the translators': their bodies are for one reply. Chat reports usage only when asked. */
const streamBodyOf = (route: Route, request: CanonicalRequest): object => ({
  ...bodyOf(route, request),
  stream: true,
  ...(route.executor.format === 'openai-chat' ? { stream_options: { include_usage: true } } : {}),
})

async function* eventsOf(route: Route, request: CanonicalRequest, signal: AbortSignal | undefined): AsyncGenerator<CanonicalStreamEvent> {
  const translator = route.streamTranslator.create()
  for await (const raw of route.executor.stream({ body: streamBodyOf(route, request), stream: true }, route.connection, signal)) {
    for (const event of translator.feed(raw)) {
      yield event
      if (event.kind === 'end' || event.kind === 'error') return
    }
  }
  yield* translator.finish()
}

/** The whole answer of a stream, or the failure: an `error` event or a stream with no `end` is never an answer. */
export const collectStream = async (events: AsyncIterable<CanonicalStreamEvent>): Promise<CanonicalResponse> => {
  let text = ''
  let usage: CanonicalResponse['usage'] = { tokensIn: 0, tokensOut: 0, cachedTokensIn: 0 }
  for await (const event of events) {
    if (event.kind === 'text') text += event.text
    else if (event.kind === 'usage') usage = event.usage
    else if (event.kind === 'error') throw new GatewayError(event.code, event.retryAfter)
    else if (event.kind === 'end') return { text, toolCalls: [], finish: event.finish, usage, model: event.model }
  }
  throw new GatewayError('PROVIDER_UNAVAILABLE')
}

export const createRouter = (policy: RoutingPolicy, deps: RouterDeps = {}) => {
  const { primary, fallbacks, retry } = policy
  const { cooldown } = deps

  const retryOptions = (signal: AbortSignal | undefined) => ({
    ...retry,
    ...(signal ? { signal } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    ...(deps.random ? { random: deps.random } : {}),
  })

  /** One route after another until one answers. Only transient failures move on, and only to a route the policy lists. */
  const run = async <T>(request: CanonicalRequest, signal: AbortSignal | undefined, attempt: (route: Route) => Promise<T>): Promise<Routed<T>> => {
    let first: GatewayError | null = null
    let last: GatewayError | null = null
    for (const route of [primary, ...fallbacks]) {
      if (signal?.aborted) throw new GatewayError('CANCELLED')
      if (await cooldown?.isCoolingDown(route.connection.connectionId, route.model)) {
        last = new GatewayError('RATE_LIMITED')
        first ??= last
        continue
      }
      try {
        const value = await withRetry(() => attempt(route), retryOptions(signal))
        return { value, route, fallbackUsed: route !== primary, fallbackFrom: route === primary ? null : (first?.code ?? null) }
      } catch (error) {
        // A fallback that can't carry the request is skipped; the primary's own failure is what the caller hears.
        if (error instanceof UnsupportedFeature && route !== primary && last) continue
        if (!(error instanceof GatewayError)) throw error
        if (error.code === 'RATE_LIMITED') await cooldown?.startCooldown(route.connection.connectionId, error.retryAfter, route.model)
        if (!transientCodes.has(error.code)) throw route === primary || error.code === 'CANCELLED' ? error : (first ?? error)
        first ??= error
        last = error
      }
    }
    throw last ?? new GatewayError('RATE_LIMITED')
  }

  const complete = (request: CanonicalRequest, signal?: AbortSignal): Promise<Routed<CanonicalResponse>> =>
    run(request, signal, async (route) => route.responseTranslator.parse(await route.executor.execute({ body: bodyOf(route, request), stream: false }, route.connection, signal)))

  /** Opens the stream and waits for its first event, so a failure before any byte can still retry or fall back. */
  const open = async (route: Route, request: CanonicalRequest, signal: AbortSignal | undefined): Promise<AsyncIterable<CanonicalStreamEvent>> => {
    const iterator = eventsOf(route, request, signal)
    const first = await iterator.next().catch(async (error: unknown) => {
      await iterator.return(undefined)
      throw error
    })
    const head = first.done ? null : first.value
    if (!head || head.kind === 'error') {
      await iterator.return(undefined)
      throw head ? new GatewayError(head.code, head.retryAfter) : new GatewayError('PROVIDER_UNAVAILABLE')
    }
    return (async function* () {
      try {
        yield head
        if (head.kind === 'end') return
        for (;;) {
          let step: IteratorResult<CanonicalStreamEvent>
          try {
            step = await iterator.next()
          } catch (error) {
            // After the first byte nothing is retried or switched: the failure reaches the caller as the error it is.
            const failure = error instanceof GatewayError ? error : new GatewayError('PROVIDER_UNAVAILABLE')
            step = { done: false, value: { kind: 'error', code: failure.code, retryAfter: failure.retryAfter } }
          }
          if (step.done) return
          if (step.value.kind === 'error' && step.value.code === 'RATE_LIMITED') await cooldown?.startCooldown(route.connection.connectionId, step.value.retryAfter, route.model)
          yield step.value
          if (step.value.kind === 'end' || step.value.kind === 'error') return
        }
      } finally {
        await iterator.return(undefined)
      }
    })()
  }

  const stream = (request: CanonicalRequest, signal?: AbortSignal): Promise<Routed<AsyncIterable<CanonicalStreamEvent>>> => run(request, signal, (route) => open(route, request, signal))

  return { complete, stream }
}

export type Router = ReturnType<typeof createRouter>
