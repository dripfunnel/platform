export class ShopApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type GraphQLResponse<T> = { data?: T; errors?: { message: string; extensions?: { code?: string } }[] }

export type ShopClientOptions = { endpoint?: string; timeoutMs?: number }

export const createShopClient = ({ endpoint = '/shop-api', timeoutMs = 10_000 }: ShopClientOptions = {}) => ({
  async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await response.json()) as GraphQLResponse<T>
    const error = body.errors?.[0]
    if (error) throw new ShopApiError(error.extensions?.code ?? 'UNKNOWN', error.message)
    if (!body.data) throw new ShopApiError('EMPTY_RESPONSE', 'The Shop API returned no data.')
    return body.data
  },
})

export type ShopClient = ReturnType<typeof createShopClient>
