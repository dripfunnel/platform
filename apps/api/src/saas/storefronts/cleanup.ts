import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { failureCode, logEvent } from '#core/log'
import { markFilesDeleted, markPreviewsTidied, markStoreFilesDeleted, selectClosedStoresToErase, selectExpiredBuilds, selectPreviewCleanups } from '#db/scoped/publishing'
import { buildFolder, draftBundle, previewRoot, snapshotFile, snapshotsPrefix, sourceBundle, sourcesPrefix, stagingFolder, storePrefix } from './layout'
import { deletePrefix, type SitesBucket } from './templates'

// Clean-up of the storefront buckets (storefront LIVE-SHOP.md §4 step 11, PREVIEW.md §3), run daily by the cron. Each part
// takes a bounded batch, so a large backlog drains over several days rather than one long run.

/** Decided on #317 (LIVE-SHOP §11): the builds a store keeps beyond any a version in its history names. */
export const keptBuilds = 20
/** SAAS §4.2: a closed store's files stay 90 days, then go. */
const closedStoreDays = 90
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

/** One item's failure is logged and left for the next day; it never stops the rest of the batch. */
const each = async <T>(items: readonly T[], storeOf: (item: T) => string, work: (item: T) => Promise<number>): Promise<number> => {
  let done = 0
  for (const item of items) {
    try {
      done += await work(item)
    } catch (error) {
      logEvent({ event: 'storefront_cleanup_item_failed', api: 'system', storeId: storeOf(item), code: failureCode(error) })
    }
  }
  return done
}

export const cleanStorefronts = async (sql: postgres.Sql, b: StorefrontBuckets, now: Date): Promise<{ builds: number; previews: number; stores: number }> => {
  const builds = await each(await withSystemScope(sql, (tx) => selectExpiredBuilds(tx, keptBuilds, batch)), (build) => build.store_id, async (build) => {
    await deleteBuild(b, build.store_id, build.id)
    await withSystemScope(sql, (tx) => markFilesDeleted(tx, build.id, now))
    return 1
  })
  const previews = await each(await withSystemScope(sql, (tx) => selectPreviewCleanups(tx, batch)), (store) => store.store_id, async (store) => {
    const deleted = await deleteOldPreviews(b.sites, store.store_id, store.current, store.published_at)
    await withSystemScope(sql, (tx) => markPreviewsTidied(tx, store.store_id, store.published_at))
    return deleted
  })
  const stores = await each(await withSystemScope(sql, (tx) => selectClosedStoresToErase(tx, new Date(now.getTime() - closedStoreDays * dayMs), batch)), (storeId) => storeId, async (storeId) => {
    await eraseStore(b, storeId)
    await withSystemScope(sql, (tx) => markStoreFilesDeleted(tx, storeId, now))
    return 1
  })
  return { builds, previews, stores }
}
