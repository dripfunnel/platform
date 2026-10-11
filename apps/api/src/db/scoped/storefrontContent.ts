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

export interface ShopContentRow {
  id: string
  kind: ContentKind
  slug: string
  title: string
  body: unknown[]
  seo_title: string | null
  seo_description: string | null
  publish_at: Date | null
  in_menu: boolean
  author: string | null
  tags: string[]
  cover_asset_id: string | null
  updated_at: Date
}

// The shopper's language where the page has it, the main language's words otherwise (CATALOG facts 19–20).
const shopColumns = (tx: ScopedSql) => tx`
  c.id, c.kind, c.slug, coalesce(t.title, c.title) as title, coalesce(t.body, c.body) as body,
  case when t.content_id is null then c.seo_title else t.seo_title end as seo_title,
  case when t.content_id is null then c.seo_description else t.seo_description end as seo_description,
  c.publish_at, c.in_menu, c.author, to_json(c.tags) as tags, c.cover_asset_id, c.updated_at`

/** Live pages newest edit first, or posts newest date first, as the shopper reads them; RLS keeps out drafts and posts not yet due. */
export const selectShopContentList = async (tx: ScopedSql, storeId: string, kind: ContentKind, language: string, window: PageWindow, filter: { inMenu: boolean | null; tag: string | null }): Promise<ShopContentRow[]> => {
  const at = kind === 'page' ? 'c.updated_at' : 'c.publish_at'
  return tx<ShopContentRow[]>`
    select ${shopColumns(tx)} from storefront_content c
    left join storefront_content_translation t on t.content_id = c.id and t.language = ${language}
    where c.store_id = ${storeId} and c.kind = ${kind}
      and ${filter.inMenu === null ? tx`true` : tx`c.in_menu = ${filter.inMenu}`}
      and ${filter.tag === null ? tx`true` : tx`${filter.tag} = any(c.tags)`}
      and ${keysetWhere(tx, window, at, 'c.id')}
    ${keysetOrder(tx, window, at, 'c.id')}`
}

export const selectShopContent = async (tx: ScopedSql, storeId: string, kind: ContentKind, slug: string, language: string): Promise<ShopContentRow | null> =>
  (
    await tx<ShopContentRow[]>`
      select ${shopColumns(tx)} from storefront_content c
      left join storefront_content_translation t on t.content_id = c.id and t.language = ${language}
      where c.store_id = ${storeId} and c.kind = ${kind} and c.slug = ${slug}`
  )[0] ?? null

/** The web addresses of the products among `ids` the shopper may see, by id. */
export const selectShopProductSlugs = async (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<Map<string, string>> =>
  ids.length === 0
    ? new Map()
    : new Map((await tx<{ id: string; slug: string }[]>`select id, slug from product where store_id = ${storeId} and id = any(${pgArray(ids)}::uuid[])`).map((r) => [r.id, r.slug]))

export interface DuePost {
  id: string
  store_id: string
  partner_id: string
  title: string
}

/** A scheduled post whose time has come is published (FIRST-RELEASE §14), a batch at a time; system scope. */
export const publishDuePosts = async (tx: ScopedSql, now: Date, limit: number): Promise<DuePost[]> =>
  tx<DuePost[]>`
    with due as (
      select id from storefront_content where status = 'scheduled' and deleted_at is null and publish_at <= ${now}
      order by publish_at limit ${limit} for update skip locked
    )
    update storefront_content c set status = 'published', published_at = coalesce(c.published_at, c.publish_at), changed_at = ${now}
    from due, store s where c.id = due.id and s.id = c.store_id
    returning c.id, c.store_id, s.partner_id, c.title`

// A translation is out of date when the main-language words it translated have changed since.
const mainHash = (tx: ScopedSql) => tx`md5(c.title || chr(10) || c.body::text || chr(10) || coalesce(c.seo_title, '') || chr(10) || coalesce(c.seo_description, ''))`

export interface ContentTranslationRow {
  language: string
  title: string
  body: unknown[]
  seo_title: string | null
  seo_description: string | null
  changed: boolean
}

export const selectContentTranslation = async (tx: ScopedSql, storeId: string, id: string, language: string): Promise<ContentTranslationRow | null> =>
  (
    await tx<ContentTranslationRow[]>`
      select t.language, t.title, t.body, t.seo_title, t.seo_description, t.source_hash <> ${mainHash(tx)} as changed
      from storefront_content_translation t join storefront_content c on c.id = t.content_id
      where t.content_id = ${id} and t.store_id = ${storeId} and t.language = ${language} and c.deleted_at is null`
  )[0] ?? null

export interface ContentTranslationWrite {
  title: string
  body: unknown[]
  seoTitle: string | null
  seoDescription: string | null
  assetIds: readonly string[]
  productIds: readonly string[]
}

export const upsertContentTranslation = async (tx: ScopedSql, storeId: string, id: string, language: string, w: ContentTranslationWrite, now: Date): Promise<void> => {
  await tx`
    insert into storefront_content_translation (content_id, store_id, language, title, body, seo_title, seo_description, asset_ids, product_ids, source_hash, updated_at)
    select c.id, c.store_id, ${language}, ${w.title}, ${doc(tx, w.body)}, ${w.seoTitle}, ${w.seoDescription}, ${pgArray(w.assetIds)}::uuid[], ${pgArray(w.productIds)}::uuid[], ${mainHash(tx)}, ${now}
    from storefront_content c where c.id = ${id} and c.store_id = ${storeId}
    on conflict (content_id, language) do update set title = excluded.title, body = excluded.body, seo_title = excluded.seo_title,
      seo_description = excluded.seo_description, asset_ids = excluded.asset_ids, product_ids = excluded.product_ids,
      source_hash = excluded.source_hash, updated_at = excluded.updated_at`
}

/** Another language's words changed what a shopper sees: it waits for the next publish like any edit. */
export const touchContent = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<void> => {
  await tx`update storefront_content set changed_at = ${now} where id = ${id} and store_id = ${storeId}`
}

export const deleteContentTranslation = async (tx: ScopedSql, storeId: string, id: string, language: string): Promise<void> => {
  await tx`delete from storefront_content_translation where content_id = ${id} and store_id = ${storeId} and language = ${language}`
}

/** The store's languages a page can be translated into: those it offers but its main one. */
export const selectTranslationLanguages = async (tx: ScopedSql, storeId: string): Promise<string[]> =>
  (await tx<{ language: string }[]>`select l.language from store_language l join store s on s.id = l.store_id where l.store_id = ${storeId} and l.status = 'active' and l.language <> s.main_language`).map((r) => r.language)
