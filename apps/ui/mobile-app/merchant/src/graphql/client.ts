import { ApiError } from './errors'

type GraphQLResponse<T> = { data?: T; errors?: { message: string; extensions?: { code?: string } & Record<string, unknown> }[] }

export type ClientOptions = {
  /** The partner's portal host, from the build configuration (CONFIGURATION.md §2). */
  domain: string
  timeoutMs?: number
  /** Read on every call: the session arrives after the client is made (REACT-NATIVE.md §5). */
  token?: () => string | null
  store?: () => string | null
  supplier?: () => string | null
  fetchImpl?: typeof fetch
}

export const defaultTimeoutMs = 15_000

// Trailing slash: the `/api/*` route misses bare `/api` (ARCHITECTURE.md §2).
export const createApiClient = ({ domain, timeoutMs = defaultTimeoutMs, token = () => null, store = () => null, supplier = () => null, fetchImpl = fetch }: ClientOptions) => {
  const endpoint = `https://${domain}/api/`

  const headers = (): Record<string, string> => {
    const bearer = token()
    const storeId = store()
    const supplierId = supplier()
    return {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(storeId ? { 'x-store': storeId } : {}),
      ...(supplierId ? { 'x-supplier': supplierId } : {}),
    }
  }

  return {
    async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      // No answer, a timeout, or a gateway's page instead of the API's JSON: one stable code,
      // so every screen shows its load-error state. The message never carries the request.
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), timeoutMs)
      let body: GraphQLResponse<T>
      try {
        const response = await fetchImpl(endpoint, { method: 'POST', headers: headers(), body: JSON.stringify({ query, variables }), signal: abort.signal })
        body = (await response.json()) as GraphQLResponse<T>
      } catch {
        throw new ApiError('NO_RESPONSE', 'The API did not answer.')
      } finally {
        clearTimeout(timer)
      }
      const error = body.errors?.[0]
      if (error) {
        const { code, ...details } = error.extensions ?? {}
        throw new ApiError(typeof code === 'string' ? code : undefined, error.message, details)
      }
      if (!body.data) throw new ApiError('BAD_RESPONSE', 'The API returned no data.')
      return body.data
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
