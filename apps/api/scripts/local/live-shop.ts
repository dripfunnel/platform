import { createHash, randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { buildFolder, manifestName, previewFolder } from '#saas/storefronts/layout'
import { manifestSchema } from '#saas/storefronts/manifest'
import { deletePrefix, type SitesBucket } from '#saas/storefronts/templates'
import { copyObject } from '#saas/storefronts/verify'
import { assertLoopbackOnly } from '../migrate/host-guard'

// Stands in for a publish where no build runs (docs/setup/local.md §6.3): a one-page build in the store's own build folder
// (storefront LIVE-SHOP.md §2), recorded and switched to as a publish does (§4 step 9). Its commit marks it for the next run.
// With `draft`, the build is a copy of the store's current preview folder (PREVIEW.md §3) instead (#726).
export const standInCommit = '0'.repeat(40)
const standInTemplate = 'local-stand-in'

interface StoreRow {
  id: string
  name: string
  slug: string
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
// The runtime files a preview imports (`./core/x.js`, and what those import) are not in its folder: the sandbox that built it serves
// them under its slot (the store's id), so they are fetched from there, once the studio has loaded the store into it.
const coreImports = (path: string, source: string): string[] =>
  [...source.matchAll(/\bfrom\s*["'](\.{1,2}\/[^"']+\.js)["']|\bimport\s*\(\s*["'](\.{1,2}\/[^"']+\.js)["']\s*\)/g)].map((m) => posix.normalize(posix.join(posix.dirname(path), m[1] ?? m[2] ?? ''))).filter((p) => p.startsWith('assets/core/'))
const coreFiles = async (sandboxUrl: string, storeId: string, files: { path: string; bytes: Uint8Array }[]): Promise<{ path: string; bytes: Uint8Array }[]> => {
  const have = new Set(files.map((f) => f.path))
  const queue = files.filter((f) => f.path.endsWith('.js')).flatMap((f) => coreImports(f.path, new TextDecoder().decode(f.bytes)))
  const fetched: { path: string; bytes: Uint8Array }[] = []
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    if (have.has(path)) continue
    have.add(path)
    const response = await fetch(`${sandboxUrl}/slots/${storeId}/client/${path}`).catch(() => null)
    if (!response?.ok) throw new Error(`The sandbox at ${sandboxUrl} did not serve ${path}${response ? ` (${response.status})` : ' (not running?)'}. Start it with pnpm --filter ./apps/sandbox start:local and open this store's studio again so it is loaded, then run this again.`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    fetched.push({ path, bytes })
    queue.push(...coreImports(path, new TextDecoder().decode(bytes)))
  }
  return fetched
}
const previewFiles = async (sql: postgres.Sql, sites: SitesBucket, storeId: string): Promise<{ path: string; bytes: Uint8Array }[]> => {
  const [draft] = await withSystemScope(sql, (tx) => tx<{ ref: string | null }[]>`select preview_deploy_ref as ref from design_draft where store_id = ${storeId}`)
  if (!draft?.ref) throw new Error('This store has no draft preview. Open its studio and make a change (Edit text works without a model key), then run this again.')
  const prefix = previewFolder(storeId, draft.ref)
  const keys: string[] = []
  for (let cursor: string | undefined; ; ) {
    const listed = await sites.list({ prefix, ...(cursor ? { cursor } : {}) })
    keys.push(...listed.objects.map((o) => o.key))
    if (!listed.truncated) break
    cursor = listed.cursor
  }
  if (keys.length === 0) throw new Error(`The draft preview folder ${prefix} is empty in the local sites bucket. Open the store's studio again to rebuild it.`)
  return Promise.all(
    keys.map(async (key) => {
      const object = await sites.get(key)
      if (!object) throw new Error(`${key} disappeared while it was being copied.`)
      return { path: key.slice(prefix.length), bytes: new Uint8Array(await object.arrayBuffer()) }
    }),
  )
}
const escaped = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export interface LiveShopOptions {
  databaseUrl: string
  sites: SitesBucket
  /** The store's id, or its code when only one store has it. */
  store: string
  /** SHOP_DOMAIN: the store lives on `{slug}.` of it. */
  shopDomain: string
  core: string
  /** Copy the studio's current preview instead of writing the stand-in page. */
  draft?: boolean
  /** Where the local sandbox answers (SANDBOX_LOCAL_URL); a draft needs it for core's runtime. */
  sandboxUrl?: string
  now?: () => Date
}

export const seedLiveShop = async ({ databaseUrl, sites, store, shopDomain, core, draft = false, sandboxUrl, now = () => new Date() }: LiveShopOptions) => {
  assertLoopbackOnly(databaseUrl)
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    const found = await withSystemScope(
      sql,
      (tx) => tx<StoreRow[]>`
        select s.id, s.name, s.slug
        from store s join storefront f on f.store_id = s.id
        where s.id::text = ${store} or s.code = ${store}`,
    )
    const [row] = found
    if (!row) throw new Error(`No store with id or code "${store}" in the local database.`)
    if (found.length > 1) throw new Error(`"${store}" is the code of ${found.length} stores; pass the id of one: ${found.map((s) => s.id).join(', ')}`)

    const buildId = randomUUID()
    const folder = buildFolder(row.id, buildId)
    const encoder = new TextEncoder()
    const edge = { path: '_edge.json', bytes: encoder.encode(JSON.stringify({ redirects: [], fallbacks: [], notFound: null })) }
    if (draft && sandboxUrl && !/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(sandboxUrl)) throw new Error(`Refusing to fetch from sandbox "${sandboxUrl}": local sandbox only (http://127.0.0.1:<port>).`)
    if (draft && !sandboxUrl) throw new Error('SANDBOX_LOCAL_URL is not set in apps/api/.env.local: the draft needs the sandbox for core\'s runtime (docs/setup/local.md §6.0).')
    const copied = draft ? await previewFiles(sql, sites, row.id) : []
    const pages = draft
      ? [...copied, ...(await coreFiles(sandboxUrl ?? '', row.id, copied)), edge]
      : [{ path: 'index.html', bytes: encoder.encode(`<!doctype html><html lang="en"><meta charset="utf-8"><title>${escaped(row.name)}</title><h1>${escaped(row.name)}</h1><p>A local stand-in site: no build ran. store-proxy serves it from the local sites bucket.</p></html>`) }, edge]
    const manifest = manifestSchema.parse({ files: pages.map((p) => ({ path: p.path, sha256: sha256(p.bytes), size: p.bytes.byteLength })) })
    for (const p of pages) await copyObject(sites, `${folder}${p.path}`, p.bytes.buffer as ArrayBuffer, sha256(p.bytes), p.path)
    const sealed = encoder.encode(JSON.stringify(manifest))
    await copyObject(sites, `${folder}${manifestName}`, sealed.buffer as ArrayBuffer, sha256(sealed), manifestName)

    const at = now()
    const replaced = await withSystemScope(sql, async (tx) => {
      await tx`
        insert into publish_run (id, store_id, kind, state, commit, template, core_version, started_by_kind, created_at, started_at, finished_at, switched_at)
        values (${buildId}, ${row.id}, 'manual', 'live', ${standInCommit}, ${standInTemplate}, ${core}, 'system', ${at}, ${at}, ${at}, ${at})`
      await tx`update storefront set live_build_id = ${buildId} where store_id = ${row.id}`
      return tx<{ id: string }[]>`delete from publish_run where store_id = ${row.id} and commit = ${standInCommit} and id <> ${buildId} returning id`
    })
    for (const old of replaced) await deletePrefix(sites, buildFolder(row.id, old.id))
    return { storeId: row.id, name: row.name, buildId, address: `${row.slug}.${shopDomain}`, files: pages.map((p) => p.path) }
  } finally {
    await sql.end()
  }
}
