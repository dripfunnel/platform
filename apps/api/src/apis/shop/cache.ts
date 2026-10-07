import { Kind, OperationTypeNode, parse, type OperationDefinitionNode } from 'graphql'
import type { Shopper } from '#auth/shopCaller'
import { readCapped } from '#core/http'

// The Shop API's edge cache (PLATFORM-PROMPT §5.5), keyed by store, catalogue version, host, language, currency and market:
// a change a storefront shows moves the version (migration 0064), so an older answer is never served again.

export interface ShopCache {
  match: (key: Request) => Promise<Response | undefined>
  put: (key: Request, response: Response) => Promise<void>
}

/** The catalogue's root fields; anything else (a cart, an account, later) is never cached. */
const cacheable = new Set(['store', 'menu', 'collections', 'collection', 'products', 'search', 'product'])
const shopCacheSeconds = 300
// Only the data centre's copy is kept: a browser or a cache in front can't see the version move, nor the headers the key reads.
const servedControl = 'private, no-store'
const maxBody = 64 * 1024

interface GraphqlRequest {
  query: string
  variables: unknown
  operationName: string | null
}

const readRequest = async (request: Request): Promise<GraphqlRequest | null> => {
  if (request.method === 'GET') {
    const url = new URL(request.url)
    const query = url.searchParams.get('query')
    const variables = url.searchParams.get('variables')
    if (!query) return null
    try {
      return { query, variables: variables ? (JSON.parse(variables) as unknown) : null, operationName: url.searchParams.get('operationName') }
    } catch {
      return null
    }
  }
  if (request.method !== 'POST' || !(request.headers.get('content-type') ?? '').includes('application/json')) return null
  // Never buffered past the cap, whatever length the body claims.
  const body = await readCapped(request.clone(), maxBody)
  if (!body.ok) return null
  const text = new TextDecoder().decode(body.bytes)
  try {
    const body = JSON.parse(text) as { query?: unknown; variables?: unknown; operationName?: unknown }
    return typeof body.query === 'string' ? { query: body.query, variables: body.variables ?? null, operationName: typeof body.operationName === 'string' ? body.operationName : null } : null
  } catch {
    return null
  }
}

/** Whether the operation that runs reads only the catalogue: a query, every root field one of `cacheable`, no fragments at the root. */
export const readsCatalogueOnly = (query: string, operationName: string | null): boolean => {
  let document
  try {
    document = parse(query)
  } catch {
    return false
  }
  const operations = document.definitions.filter((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION)
  const operation = operationName ? operations.find((o) => o.name?.value === operationName) : operations.length === 1 ? operations[0] : undefined
  if (!operation || operation.operation !== OperationTypeNode.QUERY) return false
  return operation.selectionSet.selections.every((s) => s.kind === Kind.FIELD && cacheable.has(s.name.value))
}

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')

/** The cache key for a catalogue request, or null for one that mustn't be cached. */
export const shopCacheKey = async (request: Request, shopper: Shopper, host: string): Promise<Request | null> => {
  const graphql = await readRequest(request)
  if (!graphql || !readsCatalogueOnly(graphql.query, graphql.operationName)) return null
  const digest = await sha256(JSON.stringify([graphql.query, graphql.variables, graphql.operationName]))
  const parts = [shopper.context.storeId, shopper.catalogVersion, host.toLowerCase(), shopper.language, shopper.currency, shopper.marketId ?? '-', digest]
  return new Request(`https://shop-cache.invalid/${parts.map(encodeURIComponent).join('/')}`)
}

/**
 * Serves a catalogue request from the cache, or runs it and keeps a clean answer. An answer with errors or a status
 * other than 200 is never kept, so a refusal (an unavailable store) is never served from it.
 */
export const throughShopCache = async (cache: ShopCache | null, key: Request | null, run: () => Promise<Response> | Response, keep: (work: Promise<void>) => void): Promise<Response> => {
  if (!cache || !key) return await run()
  const hit = await cache.match(key)
  if (hit) {
    const served = new Response(hit.body, hit)
    served.headers.set('x-shop-cache', 'hit')
    served.headers.set('cache-control', servedControl)
    return served
  }
  const response = await run()
  if (response.status !== 200) return response
  const text = await response.text()
  const clean = (() => {
    try {
      return !('errors' in (JSON.parse(text) as object))
    } catch {
      return false
    }
  })()
  const headers = new Headers(response.headers)
  headers.set('x-shop-cache', 'miss')
  headers.set('cache-control', servedControl)
  if (clean) {
    // Only what describes the answer is kept: nothing request-specific is replayed to the next shopper.
    const stored = new Headers({ 'content-type': headers.get('content-type') ?? 'application/json', 'cache-control': `public, max-age=${shopCacheSeconds}` })
    keep(cache.put(key, new Response(text, { status: 200, headers: stored })))
  }
  return new Response(text, { status: 200, headers })
}
