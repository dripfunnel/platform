import { createHash, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { buildFolder, manifestName } from '#saas/storefronts/layout'
import { manifestSchema } from '#saas/storefronts/manifest'
import { deletePrefix, type SitesBucket } from '#saas/storefronts/templates'
import { copyObject } from '#saas/storefronts/verify'
import { assertLoopbackOnly } from '../migrate/host-guard'

// Stands in for a publish where no build runs (docs/setup/local.md §6.3): a one-page build in the store's own build folder
// (storefront LIVE-SHOP.md §2), recorded and switched to as a publish does (§4 step 9). Its commit marks it for the next run.
export const standInCommit = '0'.repeat(40)
const standInTemplate = 'local-stand-in'

interface StoreRow {
  id: string
  name: string
  address: string | null
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const escaped = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export interface LiveShopOptions {
  databaseUrl: string
  sites: SitesBucket
  /** The store's id, or its code when only one store has it. */
  store: string
  core: string
  now?: () => Date
}

export const seedLiveShop = async ({ databaseUrl, sites, store, core, now = () => new Date() }: LiveShopOptions) => {
  assertLoopbackOnly(databaseUrl)
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    const found = await withSystemScope(
      sql,
      (tx) => tx<StoreRow[]>`
        select s.id, s.name,
          (select s.code || substr(lower(d.host), 2) from partner_domain d
            where d.partner_id = s.partner_id and d.kind = 'shops' and d.status not in ('waiting', 'failed') limit 1) as address
        from store s join storefront f on f.store_id = s.id
        where s.id::text = ${store} or s.code = ${store}`,
    )
    const [row] = found
    if (!row) throw new Error(`No store with id or code "${store}" in the local database.`)
    if (found.length > 1) throw new Error(`"${store}" is the code of ${found.length} stores; pass the id of one: ${found.map((s) => s.id).join(', ')}`)

    const buildId = randomUUID()
    const folder = buildFolder(row.id, buildId)
    const encoder = new TextEncoder()
    const pages = [
      { path: 'index.html', bytes: encoder.encode(`<!doctype html><html lang="en"><meta charset="utf-8"><title>${escaped(row.name)}</title><h1>${escaped(row.name)}</h1><p>A local stand-in site: no build ran. store-proxy serves it from the local sites bucket.</p></html>`) },
      { path: '_edge.json', bytes: encoder.encode(JSON.stringify({ redirects: [], fallbacks: [], notFound: null })) },
    ]
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
    return { storeId: row.id, name: row.name, buildId, address: row.address }
  } finally {
    await sql.end()
  }
}
