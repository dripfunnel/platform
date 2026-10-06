export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The refusal's other facts as the API sent them (a plan's unlockedBy, a story's gaps); unchecked data. */
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
  }
}

type GraphQLResponse<T> = { data?: T; errors?: { message: string; extensions?: { code?: string } & Record<string, unknown> }[] }

// Trailing slash: the `/api/*` route misses bare `/api` (ARCHITECTURE.md §2).
// `headers` is read on every call: the merchant portal names its acting store there (ACCESS.md §4).
export const createApiClient = ({ endpoint = '/api/', timeoutMs = 15_000, headers = (): Record<string, string> => ({}) } = {}) => ({
  async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    // No answer, a timeout, or a gateway's error page instead of the API's JSON: all one
    // stable code, so every screen shows its load-error state (ui/README.md §3).
    let body: GraphQLResponse<T>
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      body = (await response.json()) as GraphQLResponse<T>
    } catch {
      throw new ApiError('NOT_CONNECTED', 'The API did not answer.')
    }
    const error = body.errors?.[0]
    if (error) {
      const { code, ...details } = error.extensions ?? {}
      throw new ApiError(typeof code === 'string' ? code : 'UNKNOWN', error.message, details)
    }
    if (!body.data) throw new ApiError('EMPTY_RESPONSE', 'The API returned no data.')
    return body.data
  },
})

export type ApiClient = ReturnType<typeof createApiClient>
