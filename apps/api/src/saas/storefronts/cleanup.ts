import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { markFilesDeleted, markStoreFilesDeleted, selectClosedStoresToErase, selectExpiredBuilds, selectPreviewCleanups } from '#db/scoped/publishing'
import { buildFolder, draftBundle, previewRoot, snapshotFile, snapshotsPrefix, sourceBundle, sourcesPrefix, stagingFolder, storePrefix } from './layout'
import { deletePrefix, type SitesBucket } from './templates'

// Clean-up of the storefront buckets (storefront LIVE-SHOP.md §4 step 11, PREVIEW.md §3), run daily by the cron. Each part
// takes a bounded batch, so a large backlog drains over several days rather than one long run.

/** Decided on #317 (LIVE-SHOP §11): the builds a store keeps beyond any a version in its history names. */
export const keptBuilds = 20
/** SAAS §4.2: a closed store's files stay 90 days, then go. */
const closedStoreDays = 90
/** A store's preview folders are looked at for a week after each publish, so a missed day still tidies them. */
const previewWindowDays = 7
const batch = 50
const dayMs = 86_400_000

export interface StorefrontBuckets {
  sites: SitesBucket
  assets: SitesBucket
  drafts: SitesBucket
}

const deleteBuild = async (b: StorefrontBuckets, storeId: string, buildId: string): Promise<void> => {
  await deletePrefix(b.sites, buildFolder(storeId, buildId))
  await deletePrefix(b.sites, stagingFolder(storeId, buildId))
  await deletePrefix(b.assets, buildFolder(storeId, buildId))
  await b.drafts.delete([sourceBundle(storeId, buildId), snapshotFile(storeId, buildId)])
}

/** Preview folders other than the current one, written before the store's latest publish went live (PREVIEW §3). */
const deleteOldPreviews = async (sites: SitesBucket, storeId: string, current: string | null, publishedAt: Date): Promise<number> => {
  const root = previewRoot(storeId)
  const stale: string[] = []
  let cursor: string | undefined
  do {
    const listed = await sites.list({ prefix: root, ...(cursor ? { cursor } : {}) })
    for (const object of listed.objects) {
      const folder = object.key.slice(root.length).split('/')[0]
      if (folder !== current && object.uploaded < publishedAt) stale.push(object.key)
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
  // R2 deletes at most 1,000 keys a call.
  for (let i = 0; i < stale.length; i += 1000) await sites.delete(stale.slice(i, i + 1000))
  return stale.length
}

const eraseStore = async (b: StorefrontBuckets, storeId: string): Promise<void> => {
  await deletePrefix(b.sites, storePrefix(storeId))
  await deletePrefix(b.assets, storePrefix(storeId))
  await b.drafts.delete([draftBundle(storeId)])
  await deletePrefix(b.drafts, sourcesPrefix(storeId))
  await deletePrefix(b.drafts, snapshotsPrefix(storeId))
}

export const cleanStorefronts = async (sql: postgres.Sql, b: StorefrontBuckets, now: Date): Promise<{ builds: number; previews: number; stores: number }> => {
  const builds = await withSystemScope(sql, (tx) => selectExpiredBuilds(tx, keptBuilds, batch))
  for (const build of builds) {
    await deleteBuild(b, build.store_id, build.id)
    await withSystemScope(sql, (tx) => markFilesDeleted(tx, build.id, now))
  }
  let previews = 0
  for (const store of await withSystemScope(sql, (tx) => selectPreviewCleanups(tx, new Date(now.getTime() - previewWindowDays * dayMs), batch)))
    previews += await deleteOldPreviews(b.sites, store.store_id, store.current, store.published_at)
  const stores = await withSystemScope(sql, (tx) => selectClosedStoresToErase(tx, new Date(now.getTime() - closedStoreDays * dayMs), batch))
  for (const storeId of stores) {
    await eraseStore(b, storeId)
    await withSystemScope(sql, (tx) => markStoreFilesDeleted(tx, storeId, now))
  }
  return { builds: builds.length, previews, stores: stores.length }
}
