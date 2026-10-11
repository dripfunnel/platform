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

/** `products/x/index.html` is `/products/x/`, as the build names its pages (core's routeAddresses). */
const addressOf = (path: string) => `/${path.replace(/(?:^|\/)index\.html$/, (m) => (m.startsWith('/') ? '/' : ''))}`

/** What to tell IndexNow, or null when the store has no public address (none yet, or this machine's). */
export const indexNowSubmission = async (deps: { sql: postgres.Sql; sites: SitesBucket }, p: IndexNowPayload): Promise<{ host: string; key: string; urls: string[] } | null> => {
  const row = await withSystemScope(deps.sql, async (tx) => ({
    host: await selectStorefrontHost(tx, p.storeId),
    key: await selectIndexNowKey(tx, p.storeId),
  }))
  if (!row.host || !row.key || isLocalhost(row.host)) return null
  const now = await pages(deps.sites, p.storeId, p.buildId)
  const before = await pages(deps.sites, p.storeId, p.previousBuildId)
  const changed = [...now].filter(([path, sha]) => before.get(path) !== sha).map(([path]) => path)
  const gone = [...before.keys()].filter((path) => !now.has(path))
  // A page nobody should find (the 404, a client-rendered fallback) is no news to a search engine.
  const urls = [...changed, ...gone].filter((path) => !/(^|\/)(_fallback|404)\//.test(path)).sort().map((path) => `https://${row.host}${addressOf(path)}`)
  return urls.length > 0 ? { host: row.host, key: row.key, urls } : null
}
