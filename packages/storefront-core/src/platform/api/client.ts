import type { z } from 'zod'

export class ShopApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type GraphQLResponse<T> = { data?: T; errors?: { message: string; extensions?: { code?: string } }[] }

/** The request headers the Shop API reads (apps/api/src/auth/shopCaller.ts). */
export const shopHeaders = {
  key: 'x-shop-key',
  language: 'x-shop-language',
  currency: 'x-shop-currency',
  market: 'x-shop-market',
  cart: 'x-shop-cart',
  session: 'x-shop-session',
} as const

/** What the shopper chose and holds; read on every request, so a change applies at once. */
export type ShopState = {
  language?: string | undefined
  currency?: string | undefined
  market?: string | undefined
  cartToken?: string | undefined
  sessionToken?: string | undefined
}

export type ShopClientOptions = {
  endpoint?: string
  /** The public store key; only needed where the host doesn't name the store (builds, other origins). */
  storeKey?: string
  timeoutMs?: number
  state?: () => ShopState
}

export const createShopClient = ({ endpoint = '/shop-api', storeKey, timeoutMs = 10_000, state = () => ({}) }: ShopClientOptions = {}) => {
  const headersFor = (): Record<string, string> => {
    const s = state()
    const pairs: [string, string | undefined][] = [
      [shopHeaders.key, storeKey],
      [shopHeaders.language, s.language],
      [shopHeaders.currency, s.currency],
      [shopHeaders.market, s.market],
      [shopHeaders.cart, s.cartToken],
      [shopHeaders.session, s.sessionToken],
    ]
    return Object.fromEntries(pairs.filter((p): p is [string, string] => typeof p[1] === 'string' && p[1] !== ''))
  }

  const request = async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headersFor() },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new ShopApiError('NETWORK', 'The Shop API could not be reached.')
    }
    const body = (await response.json().catch(() => ({}))) as GraphQLResponse<T>
    const error = body.errors?.[0]
    if (error) throw new ShopApiError(error.extensions?.code ?? 'UNKNOWN', error.message)
    if (!body.data) throw new ShopApiError(response.ok ? 'EMPTY_RESPONSE' : `HTTP_${response.status}`, 'The Shop API returned no data.')
    return body.data
  }

  /** An operation whose answer is decoded with a schema written from apps/api/schema/shop.graphql. */
  const query = async <S extends z.ZodType>(operation: string, schema: S, variables?: Record<string, unknown>): Promise<z.infer<S>> => {
    const parsed = schema.safeParse(await request<unknown>(operation, variables))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ShopApiError('BAD_RESPONSE', `Unexpected shape at ${issue?.path.join('.') ?? '?'}: ${issue?.message ?? 'unknown'}`)
    }
    return parsed.data as z.infer<S>
  }

  return { request, query }
}

export type ShopClient = ReturnType<typeof createShopClient>
