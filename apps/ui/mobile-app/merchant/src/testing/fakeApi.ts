import { ApiError, createApiClient, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { apiPath } from '../graphql'

type Handler = (variables: Record<string, unknown>, headers: Record<string, string>) => unknown

export type Call = { query: string; variables: Record<string, unknown>; headers: Record<string, string> }

/**
 * A real client (the app's own, with its headers and error handling) over a fake network: each handler answers the first
 * operation whose text contains its key, with data, or throws an ApiError that goes out as the API's error with its code.
 * A handler may be async, and sees the headers the request carried, as the API does when it scopes by store and supplier.
 */
export const fakeApi = (handlers: Record<string, Handler>, seat: { store?: string; supplier?: string | null } = {}): { client: ApiClient; calls: Call[] } => {
  const calls: Call[] = []
  const fetchImpl = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    const { query, variables = {} } = JSON.parse(init.body) as { query: string; variables?: Record<string, unknown> }
    calls.push({ query, variables, headers: init.headers })
    const key = Object.keys(handlers).find((candidate) => query.includes(candidate))
    if (!key) return { json: async () => ({ errors: [{ message: `no handler for ${query.slice(0, 60)}`, extensions: { code: 'NOT_FOUND' } }] }) }
    try {
      const data = await (handlers[key] as Handler)(variables, init.headers)
      return { json: async () => ({ data }) }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      return { json: async () => ({ errors: [{ message: error.message, extensions: { code: error.code, ...error.details } }] }) }
    }
  }) as unknown as typeof fetch
  const client = createApiClient({ domain: 'shop.test', path: apiPath, fetchImpl, token: () => 'token', store: () => seat.store ?? 'store-1', supplier: () => seat.supplier ?? null })
  return { client, calls }
}
