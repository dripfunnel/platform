import type postgres from 'postgres'
import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

// Collections, filters and menus (DATA-MODEL §7.3, migration 0043): the merchant side writes them; a
// supplier reads filters and tags its own products. Rows go as one jsonb parameter, as in catalog.ts.

const rowsOf = (tx: ScopedSql, rows: readonly object[]) => tx.json(rows as unknown as postgres.JSONValue)

const uniqueViolation = (error: unknown, constraint: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint_name' in error && error.constraint_name === constraint

export interface FacetRow {
  id: string
  name: string
  position: number
  shopper_visible: boolean
  /** Products tagged with each value, in the caller's scope: a supplier counts its own (ACCESS §7.1). */
  values: { id: string; name: string; position: number; products: number }[]
}

export const maxFacets = 200

export const countFacets = async (tx: ScopedSql, storeId: string): Promise<number> => (await tx<{ n: number }[]>`select count(*)::int as n from filter where store_id = ${storeId}`)[0]?.n ?? 0

/**
 * A page of the store's filters in their order, each with its values and their product counts from one
 * grouped count over the page. The cursor's time is the negated position, as for collectionProducts.
 */
export const selectFacets = (tx: ScopedSql, storeId: string, window: PageWindow): Promise<FacetRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<FacetRow[]>`
    with page as (
      select f.id, f.name, f.position, f.shopper_visible from filter f
      where f.store_id = ${storeId}
        and ${window.after ? tx`(-f.position, f.id) < (${window.after.occurredAt.getTime()}, ${window.after.id})` : tx`true`}
        and ${window.before ? tx`(-f.position, f.id) > (${window.before.occurredAt.getTime()}, ${window.before.id})` : tx`true`}
      order by f.position ${backwards ? tx`desc` : tx`asc`}, f.id ${backwards ? tx`asc` : tx`desc`}
      limit ${window.limit + 1}
    ), counts as (
      select pfv.filter_value_id, count(distinct pfv.product_id)::int as n
      from product_filter_value pfv join product p on p.id = pfv.product_id and p.deleted_at is null
      join filter_value v on v.id = pfv.filter_value_id
      where v.filter_id in (select id from page)
      group by pfv.filter_value_id
    )
    select page.id, page.name, page.position, page.shopper_visible,
      coalesce((select json_agg(json_build_object('id', v.id, 'name', v.name, 'position', v.position, 'products', coalesce(c.n, 0)) order by v.position)
        from filter_value v left join counts c on c.filter_value_id = v.id where v.filter_id = page.id), '[]'::json) as values
    from page
    order by page.position ${backwards ? tx`desc` : tx`asc`}, page.id ${backwards ? tx`asc` : tx`desc`}
  `
}

export interface FacetWrite {
  id: string
  name: string
  position: number
  shopperVisible: boolean
  values: { id: string; name: string; position: number; kept: boolean }[]
}

/** The filter and its values as given: kept values renamed and reordered, new ones added, the rest removed. */
export const writeFacet = async (tx: ScopedSql, storeId: string, facet: FacetWrite, exists: boolean, now: Date): Promise<void> => {
  if (exists) {
    await tx`update filter set name = ${facet.name}, position = ${facet.position}, shopper_visible = ${facet.shopperVisible}, updated_at = ${now} where id = ${facet.id} and store_id = ${storeId}`
    const kept = pgArray(facet.values.filter((v) => v.kept).map((v) => v.id))
    // A rule naming a value that goes would point at nothing: it goes with it, and the recompute follows.
    await tx`
      delete from collection_rule where store_id = ${storeId} and kind = 'filter_value'
        and args->>'valueId' in (select id::text from filter_value where filter_id = ${facet.id} and not (id = any(${kept}::uuid[])))
    `
    await tx`delete from filter_value where filter_id = ${facet.id} and not (id = any(${kept}::uuid[]))`
  } else {
    await tx`insert into filter (id, store_id, name, position, shopper_visible) values (${facet.id}, ${storeId}, ${facet.name}, ${facet.position}, ${facet.shopperVisible})`
  }
  const keptValues = facet.values.filter((v) => v.kept).map(({ id, name, position }) => ({ id, name, position }))
  const added = facet.values.filter((v) => !v.kept).map(({ id, name, position }) => ({ id, name, position }))
  if (keptValues.length > 0) {
    await tx`update filter_value v set name = x.name, position = x.position from jsonb_to_recordset(${rowsOf(tx, keptValues)}) as x(id uuid, name text, position int) where v.id = x.id and v.filter_id = ${facet.id}`
  }
  if (added.length > 0) {
    await tx`insert into filter_value (id, filter_id, store_id, name, position) select x.id, ${facet.id}, ${storeId}, x.name, x.position from jsonb_to_recordset(${rowsOf(tx, added)}) as x(id uuid, name text, position int)`
  }
}

export const selectFacetValueIds = async (tx: ScopedSql, storeId: string, facetId: string): Promise<string[] | null> => {
  const [facet] = await tx<{ ids: string[] | null }[]>`select (select json_agg(v.id) from filter_value v where v.filter_id = f.id) as ids from filter f where f.id = ${facetId} and f.store_id = ${storeId}`
  return facet ? (facet.ids ?? []) : null
}

export const deleteFacet = async (tx: ScopedSql, storeId: string, facetId: string): Promise<string | null> => {
  await tx`
    delete from collection_rule where store_id = ${storeId} and kind = 'filter_value'
      and args->>'valueId' in (select id::text from filter_value where filter_id = ${facetId} and store_id = ${storeId})
  `
  return (await tx<{ name: string }[]>`delete from filter where id = ${facetId} and store_id = ${storeId} returning name`)[0]?.name ?? null
}

/**
 * Look-alike values merged into one (CatCollections "merge"): every product tagged with a source keeps
 * the tag as the target, rules naming a source name the target, and the sources go. One filter only.
 */
export const mergeFacetValues = async (tx: ScopedSql, storeId: string, targetId: string, sourceIds: readonly string[]): Promise<number> => {
  const sources = pgArray(sourceIds)
  const [same] = await tx<{ ok: boolean }[]>`
    select count(*) = ${sourceIds.length + 1} and count(distinct filter_id) = 1 as ok
    from filter_value where store_id = ${storeId} and id = any(${pgArray([targetId, ...sourceIds])}::uuid[])
  `
  if (!same?.ok) return -1
  await tx`
    insert into product_filter_value (product_id, version_id, filter_value_id, store_id)
    select product_id, version_id, ${targetId}, store_id from product_filter_value where store_id = ${storeId} and filter_value_id = any(${sources}::uuid[])
    on conflict do nothing
  `
  await tx`
    update collection_rule set args = jsonb_set(args, '{valueId}', to_jsonb(${targetId}::text))
    where store_id = ${storeId} and kind = 'filter_value' and args->>'valueId' = any(${sources}::text[])
  `
  return (await tx`delete from filter_value where store_id = ${storeId} and id = any(${sources}::uuid[])`).count
}

/** A product's filter values, on the product or a version (fact 13), replacing what it had. */
export const setProductFilterValues = async (tx: ScopedSql, storeId: string, productId: string, rows: readonly { valueId: string; versionId: string | null }[]): Promise<void> => {
  await tx`delete from product_filter_value where product_id = ${productId}`
  if (rows.length === 0) return
  await tx`
    insert into product_filter_value (product_id, version_id, filter_value_id, store_id)
    select ${productId}, x."versionId", x."valueId", ${storeId} from jsonb_to_recordset(${rowsOf(tx, rows)}) as x("valueId" uuid, "versionId" uuid)
  `
}

/** Of the given ids, those that are filter values of this store: a tag names only a value the store has. */
export const knownFacetValues = async (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<Set<string>> =>
  new Set((await tx<{ id: string }[]>`select id from filter_value where store_id = ${storeId} and id = any(${pgArray(ids)}::uuid[])`).map((r) => r.id))

export interface CollectionListRow {
  id: string
  name: string
  slug: string
  kind: 'manual' | 'automatic'
  visibility: 'visible' | 'hidden'
  parent_id: string | null
  products: number
  computed_at: Date | null
  updated_at: Date
  created_at: Date
}

export const selectCollections = (tx: ScopedSql, storeId: string, window: PageWindow): Promise<CollectionListRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<CollectionListRow[]>`
    select c.id, c.name, c.slug, c.kind, c.visibility, c.parent_id, c.computed_at, c.updated_at, c.created_at,
      (select count(*)::int from collection_product cp join product p on p.id = cp.product_id where cp.collection_id = c.id and p.deleted_at is null) as products
    from collection c
    where c.store_id = ${storeId} and c.deleted_at is null
      and ${window.after ? tx`(c.created_at, c.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(c.created_at, c.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by c.created_at ${backwards ? tx`asc` : tx`desc`}, c.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export interface RuleRow {
  kind: 'filter_value' | 'name_contains' | 'product' | 'version' | 'price_range'
  args: Record<string, unknown>
}

export interface CollectionRow {
  id: string
  name: string
  slug: string
  description: string
  kind: 'manual' | 'automatic'
  match: 'all' | 'any'
  parent_id: string | null
  inherit_parent: boolean
  visibility: 'visible' | 'hidden'
  image_asset_id: string | null
  sort: string
  seo_title: string | null
  seo_description: string | null
  computed_at: Date | null
  rule_matches: number | null
  revision: number
  rules: RuleRow[]
}

export interface MemberRow {
  id: string
  name: string
  source: 'manual' | 'rule'
  position: number
}

/**
 * A collection's products in its order, a page at a time: hand-picked in the order given, an automatic one
 * the rules' result so far. The cursor's time is the negated position, so "newest first" is first first.
 */
export const selectCollectionProducts = (tx: ScopedSql, storeId: string, collectionId: string, window: PageWindow): Promise<MemberRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<MemberRow[]>`
    select p.id, p.name, cp.source, cp.position from collection_product cp join product p on p.id = cp.product_id
    join collection c on c.id = cp.collection_id and c.store_id = ${storeId} and c.deleted_at is null
    where cp.collection_id = ${collectionId} and p.deleted_at is null
      and ${window.after ? tx`(-cp.position, p.id) < (${window.after.occurredAt.getTime()}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(-cp.position, p.id) > (${window.before.occurredAt.getTime()}, ${window.before.id})` : tx`true`}
    order by cp.position ${backwards ? tx`desc` : tx`asc`}, p.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export const maxCollectionProducts = 1000

export const selectCollection = async (tx: ScopedSql, storeId: string, id: string): Promise<CollectionRow | null> =>
  (
    await tx<CollectionRow[]>`
      select c.id, c.name, c.slug, c.description, c.kind, c.match, c.parent_id, c.inherit_parent, c.visibility, c.image_asset_id, c.sort,
        c.seo_title, c.seo_description, c.computed_at, c.rule_matches, c.revision,
        coalesce((select json_agg(json_build_object('kind', r.kind, 'args', r.args) order by r.position) from collection_rule r where r.collection_id = c.id), '[]'::json) as rules
      from collection c where c.id = ${id} and c.store_id = ${storeId} and c.deleted_at is null
    `
  )[0] ?? null

export interface CollectionFields {
  name: string
  slug: string
  description: string
  kind: 'manual' | 'automatic'
  match: 'all' | 'any'
  parentId: string | null
  inheritParent: boolean
  visibility: 'visible' | 'hidden'
  imageAssetId: string | null
  sort: string
  seoTitle: string | null
  seoDescription: string | null
}

const slugFree = async <T>(tx: ScopedSql, base: string, write: (slug: string, sp: ScopedSql) => Promise<T>): Promise<{ value: T; slug: string }> => {
  for (let n = 1; n <= 50; n += 1) {
    const slug = n === 1 ? base : `${base.slice(0, 116)}-${n}`
    try {
      return { value: (await tx.savepoint((sp) => write(slug, sp))) as T, slug }
    } catch (error) {
      if (!uniqueViolation(error, 'collection_slug_key')) throw error
    }
  }
  throw new Error('catalogue: no free collection address after 50 tries')
}

export const maxCollections = 500

export const countCollections = async (tx: ScopedSql, storeId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from collection where store_id = ${storeId} and deleted_at is null`)[0]?.n ?? 0

/** Whether a later recompute for the store is still queued: that one will do this one's work (outbox, system scope). */
export const newerRecomputeQueued = async (tx: ScopedSql, storeId: string, outboxId: string, kind: string): Promise<boolean> =>
  (
    await tx`
      select 1 from outbox o where o.kind = ${kind} and o.store_id = ${storeId} and o.delivered_at is null and o.failed_at is null and o.id <> ${outboxId}
        and o.created_at > (select created_at from outbox where id = ${outboxId}) limit 1
    `
  ).length > 0

export const insertCollection = async (tx: ScopedSql, storeId: string, id: string, f: CollectionFields): Promise<string> =>
  (
    await slugFree(tx, f.slug, (slug, sp) => sp`
      insert into collection (id, store_id, name, slug, description, kind, match, parent_id, inherit_parent, visibility, image_asset_id, sort, seo_title, seo_description)
      values (${id}, ${storeId}, ${f.name}, ${slug}, ${f.description}, ${f.kind}, ${f.match}, ${f.parentId}, ${f.inheritParent}, ${f.visibility}, ${f.imageAssetId}, ${f.sort}, ${f.seoTitle}, ${f.seoDescription})
    `)
  ).slug

/** At the revision the editor read; null when it was stale or isn't here. */
export const updateCollection = async (tx: ScopedSql, storeId: string, id: string, revision: number, f: CollectionFields, now: Date): Promise<string | null> => {
  const { value, slug } = await slugFree(tx, f.slug, async (slug, sp) =>
    (
      await sp`
        update collection set name = ${f.name}, slug = ${slug}, description = ${f.description}, kind = ${f.kind}, match = ${f.match}, parent_id = ${f.parentId},
          inherit_parent = ${f.inheritParent}, visibility = ${f.visibility}, image_asset_id = ${f.imageAssetId}, sort = ${f.sort}, seo_title = ${f.seoTitle},
          seo_description = ${f.seoDescription}, updated_at = ${now}, revision = revision + 1,
          -- An edited automatic collection is "Updating…" until its recompute lands (fact 11).
          ${f.kind === 'automatic' ? sp`computed_at = null, rule_matches = null` : sp`rule_matches = null`}
        where id = ${id} and store_id = ${storeId} and revision = ${revision} and deleted_at is null
      `
    ).count,
  )
  return value === 1 ? slug : null
}

export const setCollectionRules = async (tx: ScopedSql, storeId: string, collectionId: string, rules: readonly RuleRow[]): Promise<void> => {
  await tx`delete from collection_rule where collection_id = ${collectionId}`
  if (rules.length === 0) return
  await tx`
    insert into collection_rule (collection_id, store_id, kind, args, position)
    select ${collectionId}, ${storeId}, x.kind, x.args, x.position from jsonb_to_recordset(${rowsOf(tx, rules.map((r, position) => ({ ...r, position })))}) as x(kind text, args jsonb, position int)
  `
}

/** A hand-picked collection's products in the order given, each one this store's; the rules' rows go. */
export const setCollectionProducts = async (tx: ScopedSql, storeId: string, collectionId: string, productIds: readonly string[]): Promise<void> => {
  await tx`delete from collection_product where collection_id = ${collectionId}`
  if (productIds.length === 0) return
  await tx`
    insert into collection_product (collection_id, product_id, store_id, position, source)
    select ${collectionId}, p.id, ${storeId}, x.position, 'manual'
    from jsonb_to_recordset(${rowsOf(tx, productIds.map((id, position) => ({ id, position })))}) as x(id uuid, position int)
    join product p on p.id = x.id and p.store_id = ${storeId} and p.deleted_at is null
  `
}

/** Soft delete (§7.1); a child moves to the top level rather than pointing at a deleted parent. */
export const softDeleteCollection = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<{ name: string } | null> => {
  const [gone] = await tx<{ name: string }[]>`update collection set deleted_at = ${now}, updated_at = ${now} where id = ${id} and store_id = ${storeId} and deleted_at is null returning name`
  if (!gone) return null
  await tx`update collection set parent_id = null, inherit_parent = false, updated_at = ${now} where parent_id = ${id} and store_id = ${storeId}`
  // Its menu links go too; what sat under one moves to the top level rather than going with it.
  await tx`update menu_item set parent_id = null where store_id = ${storeId} and parent_id in (select mi.id from menu_item mi where mi.store_id = ${storeId} and mi.collection_id = ${id})`
  await tx`update menu set revision = revision + 1, updated_at = ${now} where store_id = ${storeId} and id in (select menu_id from menu_item where store_id = ${storeId} and collection_id = ${id})`
  await tx`delete from menu_item where store_id = ${storeId} and collection_id = ${id}`
  return gone
}

/** The collections the store has and the products, of the given ids, that are its own: a rule or link names only these. */
export const knownCatalogueIds = async (tx: ScopedSql, storeId: string, ids: { collections: readonly string[]; products: readonly string[]; versions: readonly string[]; values: readonly string[] }) => {
  const [row] = await tx<{ collections: string[] | null; products: string[] | null; versions: string[] | null; values: string[] | null }[]>`
    select
      (select json_agg(id) from collection where store_id = ${storeId} and deleted_at is null and id = any(${pgArray(ids.collections)}::uuid[])) as collections,
      (select json_agg(id) from product where store_id = ${storeId} and deleted_at is null and id = any(${pgArray(ids.products)}::uuid[])) as products,
      (select json_agg(id) from product_version where store_id = ${storeId} and deleted_at is null and id = any(${pgArray(ids.versions)}::uuid[])) as versions,
      (select json_agg(id) from filter_value where store_id = ${storeId} and id = any(${pgArray(ids.values)}::uuid[])) as values
  `
  return { collections: new Set(row?.collections ?? []), products: new Set(row?.products ?? []), versions: new Set(row?.versions ?? []), values: new Set(row?.values ?? []) }
}

const ruleSql = (tx: ScopedSql, rule: RuleRow) => {
  const a = rule.args
  switch (rule.kind) {
    case 'filter_value':
      return tx`exists (select 1 from product_filter_value pfv where pfv.product_id = p.id and pfv.filter_value_id = ${String(a['valueId'])}::uuid)`
    case 'name_contains':
      return tx`p.name ilike ${`%${String(a['text']).replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%`}`
    case 'product':
      return tx`p.id = ${String(a['productId'])}::uuid`
    case 'version':
      return tx`exists (select 1 from product_version v where v.id = ${String(a['versionId'])}::uuid and v.product_id = p.id and v.deleted_at is null)`
    case 'price_range':
      return tx`exists (select 1 from version_price vp join product_version v on v.id = vp.version_id where v.product_id = p.id and v.deleted_at is null
        and vp.currency = ${String(a['currency'])} and vp.amount between ${String(a['min'])}::bigint and ${String(a['max'])}::bigint)`
  }
}

/**
 * Every automatic collection's products from its rules (fact 11), parents first so a child limited to
 * its parent reads the parent's new result. Run after commit, from the outbox, never in the request (fact 14).
 */
export const recomputeCollections = async (tx: ScopedSql, storeId: string, now: Date): Promise<number> => {
  const collections = await tx<{ id: string; match: 'all' | 'any'; parent_id: string | null; inherit_parent: boolean; depth: number; rules: RuleRow[] }[]>`
    with recursive tree as (
      select id, parent_id, 0 as depth from collection where store_id = ${storeId} and deleted_at is null and parent_id is null
      union all
      select c.id, c.parent_id, tree.depth + 1 from collection c join tree on c.parent_id = tree.id where c.deleted_at is null
    )
    select c.id, c.match, c.parent_id, c.inherit_parent, tree.depth,
      coalesce((select json_agg(json_build_object('kind', r.kind, 'args', r.args) order by r.position) from collection_rule r where r.collection_id = c.id), '[]'::json) as rules
    from collection c join tree on tree.id = c.id
    where c.kind = 'automatic'
    order by tree.depth
  `
  for (const c of collections) {
    const parts = c.rules.map((r) => ruleSql(tx, r))
    const joined = parts.reduce((acc, part, i) => (i === 0 ? part : c.match === 'all' ? tx`${acc} and ${part}` : tx`${acc} or ${part}`), tx`false`)
    const inParent = c.inherit_parent && c.parent_id ? tx`and exists (select 1 from collection_product pp where pp.collection_id = ${c.parent_id} and pp.product_id = p.id)` : tx``
    // Newest first, so which products a cut keeps is the same at every recompute.
    const [found] = await tx<{ n: number }[]>`
      select count(*)::int as n from product p where p.store_id = ${storeId} and p.deleted_at is null and not p.is_sample and (${joined}) ${inParent}
    `
    await tx`
      with matched as (
        select p.id, row_number() over (order by p.created_at desc, p.id desc) - 1 as position
        from product p where p.store_id = ${storeId} and p.deleted_at is null and not p.is_sample and (${joined}) ${inParent}
        order by p.created_at desc, p.id desc
        limit ${maxCollectionProducts}
      ), dropped as (
        delete from collection_product cp where cp.collection_id = ${c.id} and not exists (select 1 from matched m where m.id = cp.product_id)
      )
      insert into collection_product (collection_id, product_id, store_id, position, source, computed_at)
      select ${c.id}, m.id, ${storeId}, m.position, 'rule', ${now} from matched m
      on conflict (collection_id, product_id) do update set position = excluded.position, source = 'rule', computed_at = excluded.computed_at
    `
    await tx`update collection set computed_at = ${now}, rule_matches = ${found?.n ?? 0} where id = ${c.id}`
  }
  return collections.length
}

export interface MenuItemRow {
  id: string
  parent_id: string | null
  label: string
  kind: 'collection' | 'page' | 'url'
  collection_id: string | null
  url: string | null
  position: number
}

export const selectMenu = async (tx: ScopedSql, storeId: string): Promise<{ id: string; name: string; revision: number; items: MenuItemRow[] } | null> =>
  (
    await tx<{ id: string; name: string; revision: number; items: MenuItemRow[] }[]>`
      select m.id, m.name, m.revision,
        coalesce((select json_agg(json_build_object('id', i.id, 'parent_id', i.parent_id, 'label', i.label, 'kind', i.kind, 'collection_id', i.collection_id, 'url', i.url, 'position', i.position)
          order by i.parent_id nulls first, i.position) from menu_item i where i.menu_id = m.id), '[]'::json) as items
      from menu m where m.store_id = ${storeId} and m.key = 'main'
    `
  )[0] ?? null

/**
 * The main menu as given (one level of nesting), at the revision the editor read, or made if the store
 * has none yet; null when another save came first.
 */
export const writeMenu = async (tx: ScopedSql, storeId: string, revision: number | null, name: string, items: readonly Omit<MenuItemRow, 'position'>[], now: Date): Promise<number | null> => {
  const existing = await selectMenu(tx, storeId)
  let menuId: string
  let next: number
  if (!existing) {
    if (revision !== null && revision !== 0) return null
    menuId = crypto.randomUUID()
    next = 1
    await tx`insert into menu (id, store_id, key, name) values (${menuId}, ${storeId}, 'main', ${name})`
  } else {
    if (existing.revision !== revision) return null
    menuId = existing.id
    next = existing.revision + 1
    await tx`update menu set name = ${name}, updated_at = ${now}, revision = ${next} where id = ${menuId}`
    await tx`delete from menu_item where menu_id = ${menuId}`
  }
  const withPositions = (parent: string | null) => items.filter((i) => i.parent_id === parent).map((i, position) => ({ ...i, position }))
  const top = withPositions(null)
  const children = top.flatMap((t) => withPositions(t.id))
  for (const level of [top, children]) {
    if (level.length === 0) continue
    await tx`
      insert into menu_item (id, menu_id, store_id, parent_id, label, kind, collection_id, url, position)
      select x.id, ${menuId}, ${storeId}, x.parent_id, x.label, x.kind, x.collection_id, x.url, x.position
      from jsonb_to_recordset(${rowsOf(tx, level)}) as x(id uuid, parent_id uuid, label text, kind text, collection_id uuid, url text, position int)
    `
  }
  return next
}
