import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { previewSlugOf, selectStorefrontByPreviewSlug } from '#db/scoped/shopCaller'
import { frameClosed, studioFrameOf, studioStoreHeader } from '#saas/studio/index'

// `/__studio/{session}/…` on a store's preview host (storefront AI-STUDIO §3 step 6), reached only through store-proxy's
// StorefrontEdge binding (router.ts). The store is the host's, and the store's Durable Object checks the session.

export interface StudioFrameStub {
  /** Whether the session is live for this store (AI-STUDIO §8 "Checked on every request"). */
  check: (storeId: string, session: string) => Promise<boolean>
  fetch: (request: Request) => Promise<Response>
}

export interface StudioFrameDeps {
  sql: postgres.Sql
  previewDomain: string | null
  studioFor: (storeId: string) => StudioFrameStub | null
  shop: (request: Request) => Promise<Response>
}

/** The store a preview host names by its slug: the only way the frame finds its store (PREVIEW §6). */
const storeOfHost = async (sql: postgres.Sql, host: string, shopDomain: string): Promise<string | null> => {
  const slug = previewSlugOf(host, shopDomain)
  if (slug === null) return null
  return (await withSystemScope(sql, (tx) => selectStorefrontByPreviewSlug(tx, slug)))?.store_id ?? null
}

export const handleStudioFrame = async (request: Request, deps: StudioFrameDeps): Promise<Response> => {
  const url = new URL(request.url)
  const frame = studioFrameOf(url.pathname)
  if (!frame || !deps.previewDomain) return frameClosed()
  const storeId = await storeOfHost(deps.sql, url.hostname, deps.previewDomain)
  const studio = storeId ? deps.studioFor(storeId) : null
  if (!storeId || !studio) return frameClosed()
  if (frame.rest === '/shop-api' || frame.rest.startsWith('/shop-api/')) {
    if (!(await studio.check(storeId, frame.session))) return frameClosed()
    // The preview host's Shop API (PREVIEW §5 step 5): a guest, in test mode; the id stays out of its path and cache.
    const target = new URL(url)
    target.pathname = frame.rest
    return deps.shop(new Request(target, request))
  }
  const forwarded = new Request(request)
  forwarded.headers.set(studioStoreHeader, storeId)
  return studio.fetch(forwarded)
}
