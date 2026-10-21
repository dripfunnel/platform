import type postgres from 'postgres'
import { z } from 'zod'
import { isLocalhost } from '#core/config'
import { withSystemScope } from '#db/scoped/index'
import { selectIndexNowKey, selectStorefrontHost } from '#db/scoped/publishing'
import { buildFolder, manifestName } from './layout'
import { manifestSchema, type Manifest } from './manifest'
import type { SitesBucket } from './templates'

// IndexNow on every publish and single-page render (storefront ARCHITECTURE §8): the pages whose bytes changed since the
// build before, added or gone, as addresses on the store's own host. Queued once the build stayed live.

export const indexNowPayload = z.strictObject({ storeId: z.uuid(), buildId: z.uuid(), previousBuildId: z.uuid().nullable() })
export type IndexNowPayload = z.infer<typeof indexNowPayload>

const pages = async (sites: SitesBucket, storeId: string, buildId: string | null): Promise<Map<string, string>> => {
  if (!buildId) return new Map()
  const object = await sites.get(`${buildFolder(storeId, buildId)}${manifestName}`)
  const parsed = manifestSchema.safeParse(object ? JSON.parse(await object.text()) : null)
  const files: Manifest['files'] = parsed.success ? parsed.data.files : []
  return new Map(files.filter((f) => f.path.endsWith('.html')).map((f) => [f.path, f.sha256]))
}

/** A served path's file in the build folder, as store-proxy maps it (files.ts): a page is its folder's `index.html`. */
const fileOf = (path: string): string => {
  const names = path.split('/').filter((n) => n !== '')
  const last = names.at(-1)
  return last === undefined || path.endsWith('/') || !last.includes('.') ? [...names, 'index.html'].join('/') : names.join('/')
}

/** The pages a build serves for addresses that have none, from its `_edge.json` (LIVE-SHOP §5 step 6): its 404 and fallbacks. */
const unlisted = async (sites: SitesBucket, storeId: string, buildId: string | null): Promise<string[]> => {
  const object = buildId ? await sites.get(`${buildFolder(storeId, buildId)}_edge.json`) : null
  if (!object) return []
  let rules: unknown
  try {
    rules = JSON.parse(await object.text())
  } catch {
    return []
  }
  const parsed = edgeRules.safeParse(rules)
  if (!parsed.success) return []
  return [...(parsed.data.notFound ? [parsed.data.notFound] : []), ...(parsed.data.fallbacks ?? []).map((f) => f.page)].map(fileOf)
}

const edgeRules = z.object({ notFound: z.string().max(2048).nullable().optional(), fallbacks: z.array(z.object({ page: z.string().max(2048) })).max(1000).optional() })

/** `products/x/index.html` is `/products/x/`, as the build names its pages (core's routeAddresses). */
const addressOf = (path: string) => `/${path.replace(/(?:^|\/)index\.html$/, (m) => (m.startsWith('/') ? '/' : ''))}`

/** What to tell IndexNow, or null when the store has no public address (none yet, or this machine's). */
export const indexNowSubmission = async (deps: { sql: postgres.Sql; sites: SitesBucket; shopDomain: string | null }, p: IndexNowPayload): Promise<{ host: string; key: string; urls: string[] } | null> => {
  const row = await withSystemScope(deps.sql, async (tx) => ({
    host: await selectStorefrontHost(tx, p.storeId, deps.shopDomain),
    key: await selectIndexNowKey(tx, p.storeId),
  }))
  if (!row.host || !row.key || isLocalhost(row.host)) return null
  const now = await pages(deps.sites, p.storeId, p.buildId)
  const before = await pages(deps.sites, p.storeId, p.previousBuildId)
  const changed = [...now].filter(([path, sha]) => before.get(path) !== sha).map(([path]) => path)
  const gone = [...before.keys()].filter((path) => !now.has(path))
  // A page nobody should find (the build's 404, its client-rendered fallbacks) is no news to a search engine.
  const hidden = new Set([...(await unlisted(deps.sites, p.storeId, p.buildId)), ...(await unlisted(deps.sites, p.storeId, p.previousBuildId))])
  const urls = [...changed, ...gone].filter((path) => !hidden.has(path)).sort().map((path) => `https://${row.host}${addressOf(path)}`)
  return urls.length > 0 ? { host: row.host, key: row.key, urls } : null
}
