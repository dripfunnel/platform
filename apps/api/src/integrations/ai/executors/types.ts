import type { ProviderCapabilities } from '../canonical'
import type { GatewayProvider } from '../gateway'
import type { FormatId } from '../translators/types'

/** A credential resolved server-side for one call; `secret` never leaves the Worker (no logs, no responses). */
export interface ResolvedConnection {
  connectionId: string
  provider: GatewayProvider
  authType: 'api_key' | 'oauth'
  secret: string
  accountId?: string
  preferredModel?: string
}

/** Single-flight per connection: concurrent callers share one refresh and get the same new secret. */
export type CredentialRefresher = (connectionId: string) => Promise<{ secret: string }>

export interface PreparedRequest<TBody = unknown> {
  body: TBody
  stream: boolean
}

/**
 * Sends a prepared body. It applies the credential, builds the URL (fixed hosts only) and headers, owns the timeout, and maps
 * upstream HTTP and network failures to GatewayError, with retryAfter parsed from seconds or an HTTP-date.
 */
export interface Executor<TBody = unknown, TRaw = unknown, TEvent = unknown> {
  readonly id: string
  readonly format: FormatId
  readonly capabilities: ProviderCapabilities
  execute: (prepared: PreparedRequest<TBody>, connection: ResolvedConnection, signal?: AbortSignal) => Promise<TRaw>
  stream: (prepared: PreparedRequest<TBody>, connection: ResolvedConnection, signal?: AbortSignal) => AsyncIterable<TEvent>
  validate: (connection: ResolvedConnection, signal?: AbortSignal) => Promise<'ok' | 'rejected' | 'unavailable'>
}
