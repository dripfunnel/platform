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

type GraphQLError = { message: string; path?: readonly (string | number)[]; extensions?: { code?: string } & Record<string, unknown> }
type GraphQLResponse<T> = { data?: T | null; errors?: GraphQLError[] }

/** One root field the API refused in an answer that still carries the others (`requestPartial`). */
export interface FieldError {
  path: readonly (string | number)[]
  error: ApiError
}

const apiErrorOf = (error: GraphQLError): ApiError => {
  const { code, ...details } = error.extensions ?? {}
  return new ApiError(typeof code === 'string' ? code : 'UNKNOWN', error.message, details)
}

const emptyResponse = () => new ApiError('EMPTY_RESPONSE', 'The API returned no data.')

// Trailing slash: the `/api/*` route misses bare `/api` (ARCHITECTURE.md §2).
// `headers` is read on every call: the merchant portal names its acting store there (ACCESS.md §4).
export const createApiClient = ({ endpoint = '/api/', timeoutMs = 15_000, headers = (): Record<string, string> => ({}) } = {}) => {
  // No answer, a timeout, or a gateway's error page instead of the API's JSON: all one
  // stable code, so every screen shows its load-error state (ui/README.md §3).
  const send = async <T>(query: string, variables?: Record<string, unknown>): Promise<GraphQLResponse<T>> => {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      return (await response.json()) as GraphQLResponse<T>
    } catch {
      throw new ApiError('NOT_CONNECTED', 'The API did not answer.')
    }
  }

  return {
    async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      const body = await send<T>(query, variables)
      const error = body.errors?.[0]
      if (error) throw apiErrorOf(error)
      if (!body.data) throw emptyResponse()
      return body.data
    },

    /** Several nullable root fields read at once: each refused field is reported by its path beside the others' data;
     *  an answer with no data at all (the operation itself refused) throws as `request` does. */
    async requestPartial<T>(query: string, variables?: Record<string, unknown>): Promise<{ data: T; errors: FieldError[] }> {
      const body = await send<T>(query, variables)
      const errors = (body.errors ?? []).map((error) => ({ path: error.path ?? [], error: apiErrorOf(error) }))
      if (!body.data) throw errors[0]?.error ?? emptyResponse()
      return { data: body.data, errors }
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
