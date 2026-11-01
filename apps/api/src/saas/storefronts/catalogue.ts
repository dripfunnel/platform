import { logEvent } from '#core/log'
import { isNewerVersion } from '#core/semver'
import { withSystemScope } from '#db/scoped/index'
import { selectBuildInput } from '#db/scoped/publishing'
import type { SitesBucket } from './templates'
import { catalogueFolder, mediaFile, snapshotFile } from './layout'
import { publishedPictureIds } from './media'

// The catalogue a version 2 snapshot carries (storefront ARCHITECTURE §4.2), recorded after the freeze in steps of their
// own (LIVE-SHOP §4 step 3), so no one Workflow step holds the whole catalogue or asks every question.

export type RecordedAnswer = { operation: string; variables: Record<string, unknown>; data: Record<string, unknown> }
/** Everything but the products' own answers, the products to record, and the store's market their answers carry. */
export type CatalogueBase = { answers: RecordedAnswer[]; collections: { slug: string }[]; slugs: string[]; store: unknown; failed: number }
export type ProductBatch = { answers: RecordedAnswer[]; products: { slug: string; versions: string[] }[]; failed: number }

/** The Shop API's answers on a store's host (apis/shop/record.ts); null where that host serves no open store. */
export interface CatalogueRecorder {
  base: (host: string) => Promise<CatalogueBase | null>
  store: (host: string) => Promise<unknown>
  products: (host: string, slugs: readonly string[], store: unknown) => Promise<ProductBatch>
}

export interface CatalogueDeps {
  sql: Parameters<typeof withSystemScope>[0]
  drafts: SitesBucket
  /** `storefront-assets`, where a dropped product's picture copies are deleted (ACCESS §11). */
  assets: Pick<SitesBucket, 'delete'>
  catalogue?: CatalogueRecorder
}

/** The first core whose build image reads a version 2 snapshot; an older one refuses its unknown field. */
const catalogueCore = '0.4.0-dev.0'
/** Products one step records. */
const productsPerStep = 100
/** Version addresses across all products: core's `maxSnapshotVersionPages`, inside the build's 5,000 files. */
export const maxCatalogueVersionPages = 2000

/** `unpublish`: a page run's picture copies that only its dropped products showed, deleted unless its own pages show them. */
type Base = Omit<CatalogueBase, 'failed'> & { host: string; unpublish?: string[] }

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
const put = async (deps: CatalogueDeps, key: string, bytes: ArrayBuffer) => {
  await deps.drafts.put(key, bytes, { sha256: hex(await crypto.subtle.digest('SHA-256', bytes)), httpMetadata: { contentType: 'application/json' } })
}
const read = async <T>(deps: CatalogueDeps, key: string): Promise<T | null> => {
  const object = await deps.drafts.get(key)
  return object ? (JSON.parse(await object.text()) as T) : null
}

const logFailed = (storeId: string, failed: number) => {
  if (failed > 0) logEvent({ event: 'storefront_catalogue_unanswered', api: 'system', storeId, count: failed })
}

// A page run's own addresses that are product pages in the main language; another language's keep their fallback.
const productSlugOf = (path: string) => /^\/products\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(path)?.[1] ?? null

/** The picture copies only the dropped products' live answers show (ACCESS §11): no other answer of the live build names them. */
const droppedPictures = (live: readonly RecordedAnswer[], dropped: ReadonlySet<string | null>): string[] => {
  const isDropped = (a: RecordedAnswer) => a.operation === 'Product' && dropped.has(String(a.variables['slug']))
  const kept = publishedPictureIds(live.filter((a) => !isDropped(a)))
  return [...publishedPictureIds(live.filter(isDropped))].filter((id) => !kept.has(id))
}

/**
 * Step `catalogue`: what the build records, as the number of product steps to follow, or null for no catalogue. A page
 * run (LIVE-SHOP §7) keeps the live build's answers and records only its own products, so it republishes nothing else.
 */
export const recordCatalogueBase = async (deps: CatalogueDeps, storeId: string, buildId: string): Promise<number | null> => {
  const input = await withSystemScope(deps.sql, (tx) => selectBuildInput(tx, storeId, buildId))
  if (!deps.catalogue || !input || input.reported || isNewerVersion(catalogueCore, input.core_version)) return null
  const snapshot = await read<{ origin: string }>(deps, snapshotFile(storeId, buildId))
  if (!snapshot) return null
  const host = new URL(snapshot.origin).host
  let base: Base
  if (input.kind === 'page' && input.render) {
    const live = input.live_build_id ? await read<{ catalogue?: { answers?: RecordedAnswer[] } | null }>(deps, snapshotFile(storeId, input.live_build_id)) : null
    const dropped = new Set(input.render.drop.map(productSlugOf))
    const slugs = [...new Set(input.render.pages.map(productSlugOf).filter((s): s is string => s !== null && !dropped.has(s)))]
    const liveAnswers = live?.catalogue?.answers ?? []
    const answers = liveAnswers.filter((a) => a.operation !== 'Product')
    base = { answers, collections: [], slugs, store: await deps.catalogue.store(host), host, unpublish: droppedPictures(liveAnswers, dropped) }
  } else {
    const recorded = await deps.catalogue.base(host)
    if (!recorded) return null
    logFailed(storeId, recorded.failed)
    base = { answers: recorded.answers, collections: recorded.collections, slugs: recorded.slugs, store: recorded.store, host }
  }
  await put(deps, `${catalogueFolder(storeId, buildId)}base.json`, encode(base))
  return Math.ceil(base.slugs.length / productsPerStep)
}

/** Step `catalogue:{n}`: the n-th hundred products' own answers. */
export const recordCatalogueProducts = async (deps: CatalogueDeps, storeId: string, buildId: string, n: number): Promise<void> => {
  const base = await read<Base>(deps, `${catalogueFolder(storeId, buildId)}base.json`)
  if (!deps.catalogue || !base) return
  const batch = await deps.catalogue.products(base.host, base.slugs.slice(n * productsPerStep, (n + 1) * productsPerStep), base.store)
  logFailed(storeId, batch.failed)
  await put(deps, `${catalogueFolder(storeId, buildId)}products-${n}.json`, encode({ answers: batch.answers, products: batch.products }))
}

/**
 * Step `snapshot`: the frozen snapshot made version 2 with the recorded catalogue, written as text one part at a time,
 * then the parts deleted. Once done it is left as it is.
 */
export const attachCatalogue = async (deps: CatalogueDeps, storeId: string, buildId: string, steps: number): Promise<void> => {
  const folder = catalogueFolder(storeId, buildId)
  const snapshot = await read<Record<string, unknown>>(deps, snapshotFile(storeId, buildId))
  const base = await read<Base>(deps, `${folder}base.json`)
  if (!snapshot || snapshot['version'] === 2 || !base) return
  const answers = [JSON.stringify(base.answers).slice(1, -1)]
  const products: ProductBatch['products'] = []
  const shown = new Set<string>()
  let versions = maxCatalogueVersionPages
  for (let n = 0; n < steps; n += 1) {
    const part = await read<Omit<ProductBatch, 'failed'>>(deps, `${folder}products-${n}.json`)
    if (!part) continue
    answers.push(JSON.stringify(part.answers).slice(1, -1))
    for (const id of publishedPictureIds(part.answers)) shown.add(id)
    // A version past the budget is served by the products' client-rendered page, as an item past the caps is.
    for (const p of part.products) {
      const own = p.versions.slice(0, versions)
      versions -= own.length
      products.push({ slug: p.slug, versions: own })
    }
  }
  // A renamed product drops its old page and records its new one, whose pictures stay.
  const gone = (base.unpublish ?? []).filter((id) => !shown.has(id))
  if (gone.length > 0) await deps.assets.delete(gone.map((id) => mediaFile(storeId, id)))
  const catalogue = `{"answers":[${answers.filter((a) => a !== '').join(',')}],"products":${JSON.stringify(products)},"collections":${JSON.stringify(base.collections)}}`
  const text = `${JSON.stringify({ ...snapshot, version: 2 }).slice(0, -1)},"catalogue":${catalogue}}`
  await put(deps, snapshotFile(storeId, buildId), new TextEncoder().encode(text).buffer)
  await deps.drafts.delete([`${folder}base.json`, ...Array.from({ length: steps }, (_, n) => `${folder}products-${n}.json`)])
}
