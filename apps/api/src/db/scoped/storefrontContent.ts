import type postgres from 'postgres'
import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'
import { keysetOrder, keysetWhere } from './keyset'

// Content pages and blog posts (DATA-MODEL §7.8, migration 0270), the merchant side's, and the redirects a rename leaves.

export type ContentKind = 'page' | 'post'
export type ContentStatus = 'draft' | 'scheduled' | 'published'

export interface ContentRow {
  id: string
  kind: ContentKind
  slug: string
  title: string
  body: unknown[]
  seo_title: string | null
  seo_description: string | null
  status: ContentStatus
  publish_at: Date | null
  published_at: Date | null
  in_menu: boolean
  author: string | null
  tags: string[]
  cover_asset_id: string | null
  revision: number
  updated_at: Date
  /** Live, or once live, and changed since the live build was made: it waits for the next publish (SAAS §9.1). */
  waiting: boolean
}

export interface ContentWrite {
  slug: string
  title: string
  body: unknown[]
  seoTitle: string | null
  seoDescription: string | null
  status: ContentStatus
  publishAt: Date | null
  inMenu: boolean
  author: string | null
  tags: readonly string[]
  coverAssetId: string | null
  assetIds: readonly string[]
  productIds: readonly string[]
}

const doc = (tx: ScopedSql, value: unknown) => tx.json(value as postgres.JSONValue)

const columns = (tx: ScopedSql) => tx`
  c.id, c.kind, c.slug, c.title, c.body, c.seo_title, c.seo_description, c.status, c.publish_at, c.published_at, c.in_menu,
  c.author, to_json(c.tags) as tags, c.cover_asset_id, c.revision, c.updated_at,
  (c.published_at is not null and (r.created_at is null or c.changed_at > r.created_at)) as waiting`

// The live build's run was made before its snapshot was read, so anything changed after it may not be on the live site.
const withLive = (tx: ScopedSql) => tx`
  from storefront_content c
  left join storefront f on f.store_id = c.store_id
  left join publish_run r on r.id = f.live_build_id`

/** Pages by when they were edited, posts by their date; newest first. */
export const selectContentList = async (tx: ScopedSql, storeId: string, kind: ContentKind, window: PageWindow): Promise<ContentRow[]> => {
  const at = kind === 'page' ? 'c.updated_at' : 'c.publish_at'
  return tx<ContentRow[]>`
    select ${columns(tx)} ${withLive(tx)}
    where c.store_id = ${storeId} and c.kind = ${kind} and c.deleted_at is null and ${keysetWhere(tx, window, at, 'c.id')}
    ${keysetOrder(tx, window, at, 'c.id')}`
}

export const selectContent = async (tx: ScopedSql, storeId: string, id: string): Promise<ContentRow | null> =>
  (await tx<ContentRow[]>`select ${columns(tx)} ${withLive(tx)} where c.id = ${id} and c.store_id = ${storeId} and c.deleted_at is null`)[0] ?? null

export const insertContent = async (tx: ScopedSql, storeId: string, kind: ContentKind, w: ContentWrite, now: Date): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into storefront_content (store_id, kind, slug, title, body, seo_title, seo_description, status, publish_at, published_at, in_menu,
      author, tags, cover_asset_id, asset_ids, product_ids, changed_at, created_at, updated_at)
    values (${storeId}, ${kind}, ${w.slug}, ${w.title}, ${doc(tx, w.body)}, ${w.seoTitle}, ${w.seoDescription}, ${w.status}, ${w.publishAt},
      ${w.status === 'published' ? now : null}, ${w.inMenu}, ${w.author}, ${pgArray(w.tags)}::text[], ${w.coverAssetId},
      ${pgArray(w.assetIds)}::uuid[], ${pgArray(w.productIds)}::uuid[], ${now}, ${now}, ${now})
    returning id`
  if (!row) throw new Error('storefront_content: insert returned no row')
  return row.id
}

/** At the revision the editor read; false when it was stale or the entry is gone. */
export const updateContent = async (tx: ScopedSql, storeId: string, id: string, revision: number, w: ContentWrite, now: Date): Promise<boolean> =>
  (
    await tx`
      update storefront_content set slug = ${w.slug}, title = ${w.title}, body = ${doc(tx, w.body)}, seo_title = ${w.seoTitle},
        seo_description = ${w.seoDescription}, status = ${w.status}, publish_at = ${w.publishAt},
        published_at = case when ${w.status} = 'published' then coalesce(published_at, ${now}) else published_at end,
        in_menu = ${w.inMenu}, author = ${w.author}, tags = ${pgArray(w.tags)}::text[], cover_asset_id = ${w.coverAssetId},
        asset_ids = ${pgArray(w.assetIds)}::uuid[], product_ids = ${pgArray(w.productIds)}::uuid[],
        changed_at = ${now}, updated_at = ${now}, revision = revision + 1
      where id = ${id} and store_id = ${storeId} and revision = ${revision} and deleted_at is null
      returning id`
  ).length === 1

/** Soft, so its path is free again and the activity log still names it; false when it was already gone. */
export const deleteContent = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<boolean> =>
  (await tx`update storefront_content set deleted_at = ${now}, changed_at = ${now}, updated_at = ${now} where id = ${id} and store_id = ${storeId} and deleted_at is null returning id`).length === 1

export interface NamespaceRow {
  custom_paths: string[]
  languages: string[]
  market_prefixes: string[]
}

/** What else holds a store's paths (storefront ARCHITECTURE §3.1): the theme's own pages, and the language and market prefixes core routes by. */
export const selectNamespace = async (tx: ScopedSql, storeId: string): Promise<NamespaceRow> =>
  (
    await tx<NamespaceRow[]>`
      select to_json(coalesce(f.custom_paths, '{}')) as custom_paths,
        to_json(array(select l.language from store_language l where l.store_id = s.id and l.status = 'active' union select s.main_language)) as languages,
        to_json(array(select m.path_prefix from market m where m.store_id = s.id and m.path_prefix is not null and m.deleted_at is null)) as market_prefixes
      from store s left join storefront f on f.store_id = s.id where s.id = ${storeId}`
  )[0] ?? { custom_paths: [], languages: [], market_prefixes: [] }

/** Every content page's and post's slug, drafts included: each holds its path (storefront ARCHITECTURE §3.1). */
export const selectContentSlugs = async (tx: ScopedSql, storeId: string): Promise<{ kind: ContentKind; slug: string }[]> =>
  tx<{ kind: ContentKind; slug: string }[]>`select kind, slug from storefront_content where store_id = ${storeId} and deleted_at is null order by kind, slug`

/** The ids among `ids` that are this store's images. */
export const selectStoreImages = async (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<string[]> =>
  ids.length === 0 ? [] : (await tx<{ id: string }[]>`select id from asset where store_id = ${storeId} and kind = 'image' and id = any(${pgArray(ids)}::uuid[])`).map((r) => r.id)

/** The ids among `ids` that are this store's products, not deleted. */
export const selectStoreProducts = async (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<string[]> =>
  ids.length === 0 ? [] : (await tx<{ id: string }[]>`select id from product where store_id = ${storeId} and deleted_at is null and id = any(${pgArray(ids)}::uuid[])`).map((r) => r.id)

/**
 * A renamed address's 301 (storefront ARCHITECTURE §8): older redirects to `from` now go straight to `to`, and none
 * may start at `to`, which a page holds again.
 */
export const redirectRenamed = async (tx: ScopedSql, storeId: string, from: string, to: string, now: Date): Promise<void> => {
  await tx`delete from storefront_redirect where store_id = ${storeId} and from_path = ${to}`
  await tx`update storefront_redirect set to_path = ${to} where store_id = ${storeId} and to_path = ${from}`
  await tx`
    insert into storefront_redirect (store_id, from_path, to_path, language, reason, created_at) values (${storeId}, ${from}, ${to}, null, 'renamed', ${now})
    on conflict (store_id, from_path, language) do update set to_path = excluded.to_path, reason = excluded.reason, created_at = excluded.created_at`
}

/** A new path takes over from any redirect that started there. */
export const clearRedirectFrom = async (tx: ScopedSql, storeId: string, path: string): Promise<void> => {
  await tx`delete from storefront_redirect where store_id = ${storeId} and from_path = ${path}`
}
