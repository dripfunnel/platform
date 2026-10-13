import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import { selectStoreEntitlement } from '#db/scoped/entitlements'
import { uniqueViolation, withScope, type ScopedSql } from '#db/scoped/index'
import {
  clearRedirectFrom,
  deleteContent,
  deleteContentTranslation,
  insertContent,
  redirectRenamed,
  selectBuildPosts,
  selectContent,
  selectContentList,
  selectContentSlugs,
  selectNamespace,
  selectStoreImages,
  selectStoreProducts,
  selectContentTranslation,
  selectTranslationLanguages,
  updateContent,
  touchContent,
  upsertContentTranslation,
  type ContentKind,
  type ContentStatus,
} from '#db/scoped/storefrontContent'
import { cleanContent, cleanTranslation, ContentInvalid, contentPath, namedIn, pathHolder, type CleanContent, type PathHolder } from './rules'

export type { ContentKind, ContentRow, ContentStatus, ContentTranslationRow } from '#db/scoped/storefrontContent'
export { contentPublishedAction, createShopContent, maxShopContentPage, publishScheduledPosts, type ShopContentBlock, type ShopContentView } from './shop'
export type { ContentBlock, PathHolder } from './rules'
export { contentPath } from './rules'

// Content pages and the blog (SAPI 24; StorefrontContent): the Owner writes, the Manager reads (ACCESS §5.1). Every
// path is one namespace with core's routes and the theme's own pages (storefront ARCHITECTURE §3.1).

export const contentAudit = {
  saved: { page: 'content_page.saved', post: 'blog_post.saved' },
  deleted: { page: 'content_page.deleted', post: 'blog_post.deleted' },
  translated: 'content.translated',
} as const

export type ContentRefusal =
  | { reason: 'INVALID_INPUT'; field: string }
  | { reason: 'NOT_FOUND' }
  | { reason: 'STALE_REVISION'; revision: number }
  | { reason: 'PATH_TAKEN'; path: string; heldBy: PathHolder }
export type ContentResult<T> = { ok: true; value: T } | ({ ok: false } & ContentRefusal)

class Refused extends Error {
  constructor(readonly refusal: ContentRefusal) {
    super(refusal.reason)
  }
}

const sameKind: Record<ContentKind, PathHolder> = { page: 'content_page', post: 'blog_post' }

/** A post dated later than now waits for the schedule; a page is live or a draft. */
const statusOf = (kind: ContentKind, clean: CleanContent, publishAt: Date | null, now: Date): ContentStatus =>
  !clean.publish ? 'draft' : kind === 'post' && publishAt && publishAt > now ? 'scheduled' : 'published'

export interface ContentDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createContentService = ({ sql, context, actor, activity, facts, now }: ContentDeps) => {
  const { storeId } = context
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const entry = (action: string, kind: ContentKind, id: string, label: string, reason: string | null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId: null,
    target: { type: kind === 'page' ? 'content_page' : 'blog_post', id, label },
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const run = async <T>(kind: ContentKind, slug: () => string, work: (tx: ScopedSql) => Promise<T>): Promise<ContentResult<T>> => {
    try {
      return { ok: true, value: await inScope(work) }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, ...error.refusal }
      if (error instanceof ContentInvalid) return { ok: false, reason: 'INVALID_INPUT', field: error.field }
      if (uniqueViolation(error, 'storefront_content_slug_key')) return { ok: false, reason: 'PATH_TAKEN', path: contentPath(kind, slug()), heldBy: sameKind[kind] }
      throw error
    }
  }

  const list = (kind: ContentKind, window: PageWindow) => inScope((tx) => selectContentList(tx, storeId, kind, window))

  const get = (id: string) => inScope((tx) => (isUuid(id) ? selectContent(tx, storeId, id) : Promise.resolve(null)))

  /** The theme's own pages (storefront.custom_paths), which Storefront › Pages lists beside the content pages (#339). */
  const customPaths = () => inScope(async (tx) => [...(await selectNamespace(tx, storeId)).custom_paths].sort())

  /** Every file and product the body names is this store's: an image, and a product not deleted. */
  const checkNamed = async (tx: ScopedSql, named: { assetIds: string[]; productIds: string[] }) => {
    if ((await selectStoreImages(tx, storeId, named.assetIds)).length !== named.assetIds.length) throw new Refused({ reason: 'INVALID_INPUT', field: 'body' })
    if ((await selectStoreProducts(tx, storeId, named.productIds)).length !== named.productIds.length) throw new Refused({ reason: 'INVALID_INPUT', field: 'body' })
  }

  const checkPath = async (tx: ScopedSql, kind: ContentKind, slug: string) => {
    const held = await selectNamespace(tx, storeId)
    const heldBy = pathHolder(kind, slug, { customPaths: held.custom_paths, languages: held.languages, marketPrefixes: held.market_prefixes })
    if (heldBy) throw new Refused({ reason: 'PATH_TAKEN', path: contentPath(kind, slug), heldBy })
  }

  /** Creates (no id) or updates at the revision read. A changed address is checked against the namespace and, once live, leaves a redirect. */
  const save = (kind: ContentKind, id: string | null, revision: number | null, input: unknown) => {
    let slug = ''
    return run(kind, () => slug, async (tx) => {
      const clean = cleanContent(kind, input)
      slug = clean.slug
      const at = now()
      const before = id === null ? null : isUuid(id) ? await selectContent(tx, storeId, id) : null
      if (id !== null && (!before || before.kind !== kind)) throw new Refused({ reason: 'NOT_FOUND' })
      if (before && before.revision !== revision) throw new Refused({ reason: 'STALE_REVISION', revision: before.revision })
      const named = namedIn(clean.body, clean.coverAssetId)
      await checkNamed(tx, named)
      if (!before || before.slug !== clean.slug) await checkPath(tx, kind, clean.slug)
      // A draft published with no date of its own goes out dated now, not the day it was first saved.
      const kept = before && !(before.status === 'draft' && clean.publish) ? before.publish_at : null
      const publishAt = kind === 'post' ? (clean.publishAt ?? kept ?? at) : null
      const status = statusOf(kind, clean, publishAt, at)
      const write = { ...clean, status, publishAt, assetIds: named.assetIds, productIds: named.productIds }
      let saved: string
      if (before) {
        if (!(await updateContent(tx, storeId, before.id, before.revision, write, at))) throw new Refused({ reason: 'STALE_REVISION', revision: before.revision })
        saved = before.id
        if (before.slug !== clean.slug && before.published_at) await redirectRenamed(tx, storeId, contentPath(kind, before.slug), contentPath(kind, clean.slug), at)
      } else {
        saved = await insertContent(tx, storeId, kind, write, at)
      }
      if (status !== 'draft') await clearRedirectFrom(tx, storeId, contentPath(kind, clean.slug))
      await activity.record(tx, entry(contentAudit.saved[kind], kind, saved, clean.title, status))
      const row = await selectContent(tx, storeId, saved)
      if (!row) throw new Error('storefront_content: the saved entry is gone')
      return row
    })
  }

  const remove = (kind: ContentKind, id: string) =>
    run(kind, () => '', async (tx) => {
      const row = isUuid(id) ? await selectContent(tx, storeId, id) : null
      if (!row || row.kind !== kind || !(await deleteContent(tx, storeId, row.id, now()))) throw new Refused({ reason: 'NOT_FOUND' })
      await activity.record(tx, entry(contentAudit.deleted[kind], kind, row.id, row.title, null))
      return true
    })

  /** Null when it has no words in that language yet: the shop shows the main language's. */
  const translation = (id: string, language: string) =>
    inScope(async (tx) => {
      const row = isUuid(id) ? await selectContent(tx, storeId, id) : null
      return row ? selectContentTranslation(tx, storeId, row.id, language) : null
    })

  /** Another offered language's words, or none (null), when the shop falls back to the main language's. */
  const saveTranslation = (kind: ContentKind, id: string, language: string, input: unknown) =>
    run(kind, () => '', async (tx) => {
      const row = isUuid(id) ? await selectContent(tx, storeId, id) : null
      if (!row || row.kind !== kind) throw new Refused({ reason: 'NOT_FOUND' })
      if (!(await selectTranslationLanguages(tx, storeId)).includes(language)) throw new Refused({ reason: 'INVALID_INPUT', field: 'language' })
      const at = now()
      if (input === null) {
        await deleteContentTranslation(tx, storeId, row.id, language)
      } else {
        const clean = cleanTranslation(kind, input)
        const named = namedIn(clean.body, null)
        await checkNamed(tx, named)
        await upsertContentTranslation(tx, storeId, row.id, language, { ...clean, ...named }, at)
      }
      await touchContent(tx, storeId, row.id, at)
      await activity.record(tx, entry(contentAudit.translated, kind, row.id, row.title, input === null ? `${language} removed` : language))
      return selectContentTranslation(tx, storeId, row.id, language)
    })

  return { list, get, customPaths, save, remove, translation, saveTranslation }
}

/**
 * The store's content page and post paths for the validator's context (storefront ARCHITECTURE §3.4 `usedPaths`): the
 * studio passes them on each change (AI-STUDIO §4) and a publish freezes them into the build's input (LIVE-SHOP §4 step 3).
 */
export const storeContentPaths = async (tx: ScopedSql, storeId: string): Promise<string[]> =>
  (await selectContentSlugs(tx, storeId)).map((r) => contentPath(r.kind, r.slug))

/** The newest published posts for a build's snapshot (#324, LIVE-SHOP §4 step 3); none while the plan has no blog. */
export const storeBuildPosts = async (tx: ScopedSql, storeId: string, now: Date, limit: number) => {
  if ((await selectStoreEntitlement(tx, storeId, 'blog', now)).enabled !== true) return []
  return (await selectBuildPosts(tx, storeId, now, limit)).map((p) => ({
    path: contentPath('post', p.slug),
    title: p.title,
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
    author: p.author,
    publishedAt: p.publish_at.toISOString(),
    image: p.cover_asset_id ? { url: `/shop-api/assets/${p.cover_asset_id}` } : null,
  }))
}
