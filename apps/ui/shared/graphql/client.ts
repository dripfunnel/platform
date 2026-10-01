export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type GraphQLResponse<T> = { data?: T; errors?: { message: string; extensions?: { code?: string } }[] }

// Trailing slash: Cloudflare's `/api/*` route pattern does not match the bare `/api`
// path (confirmed live on dev, #106), so a request without it falls through to the SPA's
// static assets instead of the Worker.
export const createApiClient = ({ endpoint = '/api/', timeoutMs = 15_000 } = {}) => ({
  async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await response.json()) as GraphQLResponse<T>
    const error = body.errors?.[0]
    if (error) throw new ApiError(error.extensions?.code ?? 'UNKNOWN', error.message)
    if (!body.data) throw new ApiError('EMPTY_RESPONSE', 'The API returned no data.')
    return body.data
  },
})

export type ApiClient = ReturnType<typeof createApiClient>
