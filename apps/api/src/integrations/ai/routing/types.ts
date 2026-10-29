import type { ReasoningEffort } from '../canonical'
import type { Executor, ResolvedConnection } from '../executors/types'
import type { RequestTranslator, ResponseTranslator, StreamTranslatorFactory } from '../translators/types'
import type { GatewayErrorCode, GatewayProvider } from '../gateway'

export interface Route {
  provider: GatewayProvider
  model: string
  connection: ResolvedConnection
  executor: Executor
  requestTranslator: RequestTranslator<unknown>
  responseTranslator: ResponseTranslator<unknown>
  streamTranslator: StreamTranslatorFactory<unknown>
  /** Sent on this route only: not every model takes one (the Claude sign-in's model does not). */
  reasoningEffort?: ReasoningEffort
}

export interface RetryPolicy {
  /** Tries in all, the first included. */
  attempts: number
  baseMs: number
  maxMs: number
}

export interface RoutingPolicy {
  primary: Route
  /** Only routes the store explicitly authorised (default none): a fallback changes who pays. */
  fallbacks: readonly Route[]
  retry: RetryPolicy
}

/** Persisted per connection (not in Worker memory); a cooled connection is skipped until the instant passes. */
export interface CooldownState {
  cooldownUntil: Date | null
}

/** What the router needs of the persisted connection health (saas/aiConnections); absent in tests that don't care. A model's cooldown holds that model only. */
export interface CooldownStore {
  isCoolingDown: (connectionId: string, model?: string) => Promise<boolean>
  startCooldown: (connectionId: string, retryAfterSeconds: number | null, model?: string) => Promise<unknown>
}

/** A result with which route produced it: `fallbackUsed` is the signal for the UI and the audit that the payer or model changed. */
export interface Routed<T> {
  value: T
  route: Route
  fallbackUsed: boolean
  /** The code of the failure that first sent the call past the primary. */
  fallbackFrom: GatewayErrorCode | null
}
