import type postgres from 'postgres'
import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

// Translations (migration 0053; CATALOG facts 18–22, N): read beside the main-language text they translate,
// each with its status, which compares the main text's md5 with the one it was translated from (N5).

export type TranslationEntity = 'product' | 'version' | 'collection' | 'filter' | 'filter_value' | 'option_name' | 'choice_name'
export type TranslationField = 'name' | 'slug' | 'description'
export type TranslationStatus = 'translated' | 'changed' | 'missing'

export interface TranslationRow {
  entity: TranslationEntity
  entity_id: string
  field: TranslationField
  main: string
  text: string | null
  status: TranslationStatus
}

/** The acting store's main language and whether `language` is one of its offered ones (N13). */
export const selectLanguages = async (tx: ScopedSql, storeId: string): Promise<{ main: string | null; active: string[] }> => {
  const [main] = await tx<{ main: string | null }[]>`select acting_store_main_language() as main`
  const rows = await tx<{ language: string }[]>`select language from store_language where store_id = ${storeId} and status = 'active' order by position`
  return { main: main?.main ?? null, active: rows.map((r) => r.language) }
}

// A shared name is keyed by its main text, lowercased, which is what it was translated from.
const statusOf = (tx: ScopedSql) =>
  tx`case when t.text is null then 'missing' when t.source_hash = md5(case when m.entity in ('option_name', 'choice_name') then m.entity_id else m.main end) then 'translated' else 'changed' end`

/**
 * A product's translatable text in `language` beside its main text: its name, web address and description, its
 * versions' names, and its options' and choices' shared names. Empty main text has nothing to translate.
 */
export const selectProductTranslation = (tx: ScopedSql, storeId: string, productId: string, language: string): Promise<TranslationRow[]> =>
  tx<TranslationRow[]>`
    with m (entity, entity_id, field, main, position) as (
      select 'product', p.id::text, f.field, f.main, f.position from product p
      cross join lateral (values ('name', p.name, 0), ('slug', p.slug, 1), ('description', p.description, 2)) as f(field, main, position)
      where p.id = ${productId} and p.store_id = ${storeId} and p.deleted_at is null and f.main <> ''
      union all
      select 'version', v.id::text, 'name', v.name, 10 + v.position from product_version v
      where v.product_id = ${productId} and v.store_id = ${storeId} and v.deleted_at is null and coalesce(v.name, '') <> ''
      union all
      select distinct on (lower(o.name)) 'option_name', lower(o.name), 'name', o.name, 1000 + o.position from product_option o
      join product p on p.id = o.product_id and p.deleted_at is null
      where o.product_id = ${productId} and o.store_id = ${storeId}
      union all
      select distinct on (lower(ov.name)) 'choice_name', lower(ov.name), 'name', ov.name, 2000 + ov.position from product_option_value ov
      join product_option o on o.id = ov.option_id join product p on p.id = o.product_id and p.deleted_at is null
      where o.product_id = ${productId} and o.store_id = ${storeId}
    )
    select m.entity, m.entity_id, m.field, m.main, t.text, ${statusOf(tx)} as status
    from m left join translation t on t.store_id = ${storeId} and t.entity = m.entity and t.entity_id = m.entity_id and t.field = m.field and t.language = ${language}
    order by m.position, m.entity_id
  `

/** A collection's, filter's or filter choice's translatable text, as the product's. */
export const selectEntityTranslation = (tx: ScopedSql, storeId: string, entity: 'collection' | 'filter' | 'filter_value', id: string, language: string): Promise<TranslationRow[]> => {
  const main =
    entity === 'collection'
      ? tx`select 'collection', c.id::text, f.field, f.main, f.position from collection c
          cross join lateral (values ('name', c.name, 0), ('slug', c.slug, 1), ('description', c.description, 2)) as f(field, main, position)
          where c.id = ${id} and c.store_id = ${storeId} and c.deleted_at is null and f.main <> ''`
      : entity === 'filter'
        ? tx`select 'filter', f.id::text, 'name', f.name, 0 from filter f where f.id = ${id} and f.store_id = ${storeId}`
        : tx`select 'filter_value', f.id::text, 'name', f.name, 0 from filter_value f where f.id = ${id} and f.store_id = ${storeId}`
  return tx<TranslationRow[]>`
    with m (entity, entity_id, field, main, position) as (${main})
    select m.entity, m.entity_id, m.field, m.main, t.text, ${statusOf(tx)} as status
    from m left join translation t on t.store_id = ${storeId} and t.entity = m.entity and t.entity_id = m.entity_id and t.field = m.field and t.language = ${language}
    order by m.position
  `
}

export interface TranslationWrite {
  entity: TranslationEntity
  entityId: string
  field: TranslationField
  /** The main-language text it translates, whose md5 marks it current. */
  main: string
  text: string
}

/** Each translation, replacing what the language had; the owner comes from the entity (0053's trigger). */
export const upsertTranslations = async (tx: ScopedSql, storeId: string, language: string, rows: readonly TranslationWrite[], now: Date): Promise<void> => {
  if (rows.length === 0) return
  await tx`
    insert into translation (store_id, entity, entity_id, field, language, text, source_hash, updated_at)
    select ${storeId}, x.entity, x."entityId", x.field, ${language}, x.text, md5(x.main), ${now}
    from jsonb_to_recordset(${tx.json(rows as unknown as postgres.JSONValue)}) as x(entity text, "entityId" text, field text, main text, text text)
    on conflict (store_id, entity, entity_id, field, language) do update set text = excluded.text, source_hash = excluded.source_hash, updated_at = excluded.updated_at
  `
}

/** Cleared fields fall back to the main language again (fact 19). */
export const deleteTranslations = async (tx: ScopedSql, storeId: string, language: string, keys: readonly { entity: TranslationEntity; entityId: string; field: TranslationField }[]): Promise<void> => {
  if (keys.length === 0) return
  await tx`
    delete from translation t using jsonb_to_recordset(${tx.json(keys as unknown as postgres.JSONValue)}) as x(entity text, "entityId" text, field text)
    where t.store_id = ${storeId} and t.language = ${language} and t.entity = x.entity and t.entity_id = x."entityId" and t.field = x.field
  `
}

/** A slug row clashes with another of the language's (fact 22). */
export const slugClash = (error: unknown): boolean => typeof error === 'object' && error !== null && 'constraint_name' in error && error.constraint_name === 'translation_slug_key'

/** Fact 19's "96 products untranslated": the caller's products with no name in the language. */
export const countUntranslatedProducts = async (tx: ScopedSql, storeId: string, language: string): Promise<{ products: number; untranslated: number }> =>
  (
    await tx<{ products: number; untranslated: number }[]>`
      select count(*)::int as products,
        count(*) filter (where not exists (select 1 from translation t where t.store_id = p.store_id and t.entity = 'product' and t.entity_id = p.id::text and t.field = 'name' and t.language = ${language}))::int as untranslated
      from product p where p.store_id = ${storeId} and p.deleted_at is null
    `
  )[0] ?? { products: 0, untranslated: 0 }

export interface SharedNameRow {
  kind: 'option_name' | 'choice_name'
  source: string
  main: string
  uses: number
  text: string | null
}

/** N6: the catalogue's option or choice names, each translated once, with how many products use it. */
export const selectSharedNames = (tx: ScopedSql, storeId: string, kind: 'option_name' | 'choice_name', language: string, window: PageWindow): Promise<SharedNameRow[]> => {
  const names =
    kind === 'option_name'
      ? tx`select lower(o.name) as source, min(o.name) as main, count(distinct o.product_id)::int as uses from product_option o
          join product p on p.id = o.product_id and p.deleted_at is null where o.store_id = ${storeId} group by lower(o.name)`
      : tx`select lower(ov.name) as source, min(ov.name) as main, count(distinct o.product_id)::int as uses from product_option_value ov
          join product_option o on o.id = ov.option_id join product p on p.id = o.product_id and p.deleted_at is null where o.store_id = ${storeId} group by lower(ov.name)`
  return tx<SharedNameRow[]>`
    select ${kind} as kind, n.source, n.main, n.uses, t.text from (${names}) n
    left join translation t on t.store_id = ${storeId} and t.entity = ${kind} and t.entity_id = n.source and t.field = 'name' and t.language = ${language}
    where ${window.after ? tx`n.source > ${window.after.id}` : tx`true`}
    order by n.source limit ${window.limit + 1}
  `
}

/** Which of these names the catalogue's live products use, lowercased, for saveSharedNames' check. */
export const existingSharedNames = async (tx: ScopedSql, storeId: string, kind: 'option_name' | 'choice_name', sources: readonly string[]): Promise<string[]> =>
  (
    await (kind === 'option_name'
      ? tx<{ source: string }[]>`select distinct lower(o.name) as source from product_option o join product p on p.id = o.product_id and p.deleted_at is null
          where o.store_id = ${storeId} and lower(o.name) = any(${pgArray(sources)}::text[])`
      : tx<{ source: string }[]>`select distinct lower(ov.name) as source from product_option_value ov join product_option o on o.id = ov.option_id join product p on p.id = o.product_id and p.deleted_at is null
          where o.store_id = ${storeId} and lower(ov.name) = any(${pgArray(sources)}::text[])`)
  ).map((r) => r.source)
