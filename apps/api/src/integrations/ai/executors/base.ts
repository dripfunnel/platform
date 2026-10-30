import type { ProviderCapabilities } from '../canonical'
import { GatewayError, type GatewayErrorCode, type GatewayProvider } from '../gateway'
import { providerHeaders } from '../headers'
import { parseRetryAfter } from '../retryAfter'
import type { FormatId } from '../translators/types'
import type { CredentialRefresher, Executor, ResolvedConnection } from './types'

// Provider calls without a translation step (docs/api/SAAS.md §9.3). Build the executors per request: the refresh
// bookkeeping below lives as long as the executor and must not outlive a Worker request.
const defaultTimeoutMs = 120_000

export interface ExecutorOptions {
  fetch?: typeof fetch
  /** Renews an OAuth connection's secret after a 401; without it a 401 is final. */
  refresh?: CredentialRefresher
  /** The whole call, a stream's last byte included. */
  timeoutMs?: number
  now?: () => Date
}

export interface ExecutorSpec {
  id: string
  format: FormatId
  provider: GatewayProvider
  authTypes: readonly ResolvedConnection['authType'][]
  capabilities: ProviderCapabilities
  /** Fixed hosts only: nothing a caller sends picks one (SSRF). */
  url: string
  modelsUrl: string
  /** The raw event after which the stream is complete; a stream that ends without one was cut. */
  isTerminal: (event: unknown) => boolean
  /** An error the provider sent inside a stream, so it never looks like success. */
  streamFailure: (event: unknown) => GatewayError | null
}

export const field = (value: unknown, ...path: readonly string[]): unknown => path.reduce<unknown>((at, key) => (typeof at === 'object' && at !== null ? Reflect.get(at, key) : undefined), value)

/** A provider's error type or code as one of ours; the message text is never read. */
export const codeOfKind = (kind: unknown): GatewayErrorCode => {
  const text = typeof kind === 'string' ? kind : ''
  if (/rate_limit|insufficient_quota/.test(text)) return 'RATE_LIMITED'
  if (/authentication|permission|invalid_api_key/.test(text)) return 'INVALID_CREDENTIALS'
  if (/not_found/.test(text)) return 'MODEL_NOT_FOUND'
  if (/invalid_request|context_length/.test(text)) return 'BAD_REQUEST'
  return 'PROVIDER_UNAVAILABLE'
}

/** An upstream status as one of ours: no body, header or key goes on. */
export const failureOfStatus = (status: number, retryAfter: string | null, now: Date): GatewayError => {
  if (status === 401 || status === 403) return new GatewayError('INVALID_CREDENTIALS')
  if (status === 404) return new GatewayError('MODEL_NOT_FOUND')
  if (status === 429) return new GatewayError('RATE_LIMITED', parseRetryAfter(retryAfter, now))
  if (status === 408) return new GatewayError('TIMEOUT')
  if (status >= 500) return new GatewayError('PROVIDER_UNAVAILABLE')
  return new GatewayError('BAD_REQUEST')
}

/** Splits an event stream into the `data` payload of each event (WHATWG HTML §9.2); other fields and comments carry nothing here. */
const sseParser = () => {
  let buffer = ''
  let data: string[] = []
  const line = (text: string, out: string[]): void => {
    if (text === '') {
      if (data.length > 0) out.push(data.join('\n'))
      data = []
    } else if (text.startsWith('data:')) data.push(text.slice(5).replace(/^ /, ''))
  }
  return {
    push: (text: string): string[] => {
      const out: string[] = []
      const lines = (buffer + text).split(/\r\n|\n|\r/)
      buffer = lines.pop() ?? ''
      for (const each of lines) line(each, out)
      return out
    },
    /** An event cut off before its blank line is still delivered: its JSON fails to parse if the cut was mid-event. */
    end: (): string[] => {
      const out: string[] = []
      line(buffer, out)
      line('', out)
      buffer = ''
      return out
    },
  }
}

export const createExecutor = (spec: ExecutorSpec, options: ExecutorOptions = {}): Executor => {
  const send = (input: string, init: RequestInit): Promise<Response> => (options.fetch ?? fetch)(input, init)
  const now = options.now ?? (() => new Date())
  const refreshing = new Map<string, Promise<string>>()
  const renewed = new Map<string, string>()

  // One refresh per connection however many calls got a 401; a call holding an older secret takes the renewed one.
  const renew = (connection: ResolvedConnection, used: string): Promise<string> => {
    const known = renewed.get(connection.connectionId)
    if (known !== undefined && known !== used) return Promise.resolve(known)
    const pending = refreshing.get(connection.connectionId)
    if (pending) return pending
    const refresh = options.refresh
    if (!refresh) return Promise.reject(new GatewayError('INVALID_CREDENTIALS'))
    const started = refresh(connection.connectionId)
      .then(({ secret }) => (renewed.set(connection.connectionId, secret), secret))
      .finally(() => refreshing.delete(connection.connectionId))
    refreshing.set(connection.connectionId, started)
    return started
  }

  const begin = (caller: AbortSignal | undefined) => {
    const deadline = AbortSignal.timeout(options.timeoutMs ?? defaultTimeoutMs)
    const signal = caller ? AbortSignal.any([caller, deadline]) : deadline
    const interrupted = (): GatewayError => new GatewayError(caller?.aborted ? 'CANCELLED' : deadline.aborted ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE')
    return { signal, interrupted }
  }
  type Call = ReturnType<typeof begin>

  const request = async (call: Call, connection: ResolvedConnection, method: 'GET' | 'POST', url: string, body: string | undefined, stream: boolean): Promise<Response> => {
    if (connection.provider !== spec.provider || !spec.authTypes.includes(connection.authType)) throw new GatewayError('BAD_REQUEST')
    let secret = connection.secret
    for (let attempt = 0; ; attempt++) {
      let response: Response
      try {
        response = await send(url, {
          method,
          ...(body !== undefined ? { body } : {}),
          redirect: 'manual',
          signal: call.signal,
          headers: providerHeaders({ provider: spec.provider, auth: connection.authType, secret, stream, hasBody: body !== undefined }),
        })
      } catch {
        throw call.interrupted()
      }
      if (response.ok) return response
      // workerd has no redirect: 'error', so a redirect is refused here and the credential goes to no other host.
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined)
        throw new GatewayError('PROVIDER_UNAVAILABLE')
      }
      await response.body?.cancel().catch(() => undefined)
      if (response.status === 401 && connection.authType === 'oauth' && attempt === 0) {
        try {
          secret = await renew(connection, secret)
        } catch (error) {
          throw error instanceof GatewayError ? error : new GatewayError('INVALID_CREDENTIALS')
        }
        continue
      }
      throw failureOfStatus(response.status, response.headers.get('retry-after'), now())
    }
  }

  return {
    id: spec.id,
    format: spec.format,
    capabilities: spec.capabilities,
    execute: async (prepared, connection, signal) => {
      const call = begin(signal)
      const response = await request(call, connection, 'POST', spec.url, JSON.stringify(prepared.body), false)
      try {
        const body: unknown = await response.json()
        return body
      } catch {
        throw call.interrupted()
      }
    },
    stream: async function* (prepared, connection, signal) {
      const call = begin(signal)
      const response = await request(call, connection, 'POST', spec.url, JSON.stringify(prepared.body), true)
      if (!response.body) throw new GatewayError('PROVIDER_UNAVAILABLE')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const parser = sseParser()
      let complete = false
      // A body that ignores the signal would leave a pending read hanging; cancelling the reader ends it.
      const stop = () => void reader.cancel().catch(() => undefined)
      call.signal.addEventListener('abort', stop, { once: true })
      try {
        for (let ended = false; !ended && !complete; ) {
          let payloads: string[]
          try {
            const { done, value } = await reader.read()
            if (call.signal.aborted) throw call.interrupted()
            ended = done
            payloads = done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(value, { stream: true }))
          } catch (error) {
            throw error instanceof GatewayError ? error : call.interrupted()
          }
          for (const payload of payloads) {
            if (payload === '[DONE]') {
              complete = true
              break
            }
            let event: unknown
            try {
              event = JSON.parse(payload)
            } catch {
              throw new GatewayError('PROVIDER_UNAVAILABLE')
            }
            const failure = spec.streamFailure(event)
            if (failure) throw failure
            yield event
            if (spec.isTerminal(event)) {
              complete = true
              break
            }
          }
        }
        if (!complete) throw new GatewayError('PROVIDER_UNAVAILABLE')
      } finally {
        call.signal.removeEventListener('abort', stop)
        await reader.cancel().catch(() => undefined)
      }
    },
    validate: async (connection, signal) => {
      try {
        await request(begin(signal), connection, 'GET', spec.modelsUrl, undefined, false)
        return 'ok'
      } catch (error) {
        return error instanceof GatewayError && error.code === 'INVALID_CREDENTIALS' ? 'rejected' : 'unavailable'
      }
    },
  }
}
