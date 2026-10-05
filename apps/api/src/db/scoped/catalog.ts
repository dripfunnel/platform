import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

// The catalogue's core (DATA-MODEL §7.3, migration 0041): every read and write runs in the caller's
// scope, so a supplier reaches its own products only and RLS is the backstop of every query here.

export type ProductFilter = 'all' | 'visible' | 'hidden' | 'pending' | 'sent_back'

export interface ProductListRow {
  id: string
  name: string
  slug: string
  visibility: 'visible' | 'hidden'
  approval_status: 'approved' | 'pending' | 'sent_back' | null
  product_type: string
  seller_id: string | null
  seller_name: string | null
  seller_status: string | null
  versions: number
  /** Minor units in the store's pricing currency, as text: the client reads bigint as a string. */
  min_amount: string | null
  max_amount: string | null
  visible_versions: number
  created_at: Date
  updated_at: Date
}

const filterOf = (tx: ScopedSql, filter: ProductFilter) => {
  switch (filter) {
    case 'visible':
      return tx`p.visibility = 'visible'`
    case 'hidden':
      return tx`p.visibility = 'hidden'`
    case 'pending':
      return tx`p.approval_status = 'pending'`
    case 'sent_back':
      return tx`p.approval_status = 'sent_back'`
    case 'all':
      return tx`true`
  }
}

export interface ProductQuery {
  filter: ProductFilter
  /** Words to find in a name or description, or null. */
  search: string | null
  /** The merchant's supplier filter: a seller id, `own` for the store's own products, or null for all. */
  seller: string | null
  currency: string | null
}

export const selectProducts = (tx: ScopedSql, storeId: string, query: ProductQuery, window: PageWindow): Promise<ProductListRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<ProductListRow[]>`
    select p.id, p.name, p.slug, p.visibility, p.approval_status, p.product_type, p.seller_id, s.name as seller_name, s.status as seller_status,
      p.created_at, p.updated_at,
      (select count(*)::int from product_version v where v.product_id = p.id and v.deleted_at is null) as versions,
      (select count(*)::int from product_version v where v.product_id = p.id and v.deleted_at is null and v.visibility = 'visible') as visible_versions,
      (select min(vp.amount)::text from version_price vp join product_version v on v.id = vp.version_id
         where v.product_id = p.id and v.deleted_at is null and vp.currency = ${query.currency}) as min_amount,
      (select max(vp.amount)::text from version_price vp join product_version v on v.id = vp.version_id
         where v.product_id = p.id and v.deleted_at is null and vp.currency = ${query.currency}) as max_amount
    from product p
    left join seller s on s.id = p.seller_id
    where p.store_id = ${storeId} and p.deleted_at is null and not p.is_sample
      and ${filterOf(tx, query.filter)}
      and ${query.seller === 'own' ? tx`p.seller_id is null` : query.seller ? tx`p.seller_id = ${query.seller}::uuid` : tx`true`}
      and ${query.search ? tx`(p.search @@ plainto_tsquery('simple', ${query.search}) or p.name ilike ${`%${query.search.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%`})` : tx`true`}
      and ${window.after ? tx`(p.created_at, p.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(p.created_at, p.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by p.created_at ${backwards ? tx`asc` : tx`desc`}, p.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export interface ProductCounts {
  all: number
  visible: number
  hidden: number
  pending: number
  sentBack: number
}

/** The list's chips, from their own query and in the caller's scope, so a supplier counts only its own (ACCESS §7.1). */
export const countProducts = async (tx: ScopedSql, storeId: string): Promise<ProductCounts> =>
  (
    await tx<ProductCounts[]>`
      select count(*)::int as "all",
        count(*) filter (where visibility = 'visible')::int as visible,
        count(*) filter (where visibility = 'hidden')::int as hidden,
        count(*) filter (where approval_status = 'pending')::int as pending,
        count(*) filter (where approval_status = 'sent_back')::int as "sentBack"
      from product where store_id = ${storeId} and deleted_at is null and not is_sample
    `
  )[0] ?? { all: 0, visible: 0, hidden: 0, pending: 0, sentBack: 0 }

export interface OptionRow {
  id: string
  name: string
  position: number
  values: { id: string; name: string; position: number }[]
}

export interface PriceRow {
  currency: string
  amount: string
  compare_at_amount: string | null
}

export interface VersionRow {
  id: string
  sku: string | null
  barcode: string | null
  name: string | null
  visibility: 'visible' | 'hidden'
  hs_code: string | null
  customs_description: string | null
  weight_grams: number | null
  length_mm: number | null
  width_mm: number | null
  height_mm: number | null
  cost_amount: string | null
  cost_currency: string | null
  track_stock: boolean | null
  continue_selling: boolean | null
  position: number
  /** Option id → value id. */
  choices: Record<string, string>
  prices: PriceRow[]
}

export interface ProductRow {
  id: string
  store_id: string
  seller_id: string | null
  seller_name: string | null
  seller_status: string | null
  name: string
  slug: string
  description: string
  product_type: 'physical' | 'digital' | 'service' | 'gift_card'
  category: string | null
  visibility: 'visible' | 'hidden'
  approval_status: 'approved' | 'pending' | 'sent_back' | null
  sent_back_reason: string | null
  warranty_text: string | null
  returns_text: string | null
  seo_title: string | null
  seo_description: string | null
  revision: number
  created_at: Date
  updated_at: Date
  options: OptionRow[]
  versions: VersionRow[]
}

/** One product with its options, values, live versions and prices, or null when the caller's scope has none. */
export const selectProduct = async (tx: ScopedSql, storeId: string, productId: string): Promise<ProductRow | null> => {
  const [row] = await tx<ProductRow[]>`
    select p.id, p.store_id, p.seller_id, s.name as seller_name, s.status as seller_status, p.name, p.slug, p.description,
      p.product_type, p.category, p.visibility, p.approval_status, p.sent_back_reason, p.warranty_text, p.returns_text,
      p.seo_title, p.seo_description, p.revision, p.created_at, p.updated_at,
      coalesce((
        select json_agg(json_build_object('id', o.id, 'name', o.name, 'position', o.position, 'values', coalesce((
          select json_agg(json_build_object('id', ov.id, 'name', ov.name, 'position', ov.position) order by ov.position)
          from product_option_value ov where ov.option_id = o.id), '[]'::json)) order by o.position)
        from product_option o where o.product_id = p.id), '[]'::json) as options,
      coalesce((
        select json_agg(json_build_object(
          'id', v.id, 'sku', v.sku, 'barcode', v.barcode, 'name', v.name, 'visibility', v.visibility, 'hs_code', v.hs_code,
          'customs_description', v.customs_description, 'weight_grams', v.weight_grams, 'length_mm', v.length_mm,
          'width_mm', v.width_mm, 'height_mm', v.height_mm, 'cost_amount', v.cost_amount::text, 'cost_currency', v.cost_currency,
          'track_stock', v.track_stock, 'continue_selling', v.continue_selling, 'position', v.position,
          'choices', coalesce((select json_object_agg(vo.option_id, vo.value_id) from product_version_option_value vo where vo.version_id = v.id), '{}'::json),
          'prices', coalesce((select json_agg(json_build_object('currency', vp.currency, 'amount', vp.amount::text, 'compare_at_amount', vp.compare_at_amount::text) order by vp.currency)
            from version_price vp where vp.version_id = v.id), '[]'::json)
        ) order by v.position)
        from product_version v where v.product_id = p.id and v.deleted_at is null), '[]'::json) as versions
    from product p
    left join seller s on s.id = p.seller_id
    where p.id = ${productId} and p.store_id = ${storeId} and p.deleted_at is null
  `
  return row ?? null
}

/** One catalogue write that changes the product count at a time per store, so the plan's limit holds when it commits. */
export const lockCatalogue = async (tx: ScopedSql, storeId: string): Promise<void> => {
  await tx`select pg_advisory_xact_lock(hashtext(${`catalogue:${storeId}`}))`
}

/** The whole store's products against the plan, whoever asks (migration 0041 `store_product_count`). */
export const countStoreProducts = async (tx: ScopedSql): Promise<number> => (await tx<{ n: number }[]>`select store_product_count() as n`)[0]?.n ?? 0

/** The acting store's pricing currency, which a supplier prices in too but can't read the store row for (migration 0041). */
export const selectPricingCurrency = async (tx: ScopedSql): Promise<string | null> => (await tx<{ c: string | null }[]>`select store_pricing_currency() as c`)[0]?.c ?? null

export interface ProductFields {
  name: string
  slug: string
  description: string
  productType: string
  category: string | null
  visibility: 'visible' | 'hidden'
  warrantyText: string | null
  returnsText: string | null
  seoTitle: string | null
  seoDescription: string | null
}

const uniqueViolation = (error: unknown, constraint: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint_name' in error && error.constraint_name === constraint

/**
 * A web address unique in the store (CATALOG fact 15): on a clash the next free `-2`, `-3`, tried
 * inside a savepoint so the transaction survives. The address taken may be another owner's, which
 * a supplier never reads; it learns only that the address is taken.
 */
const withFreeSlug = async <T>(tx: ScopedSql, base: string, write: (slug: string, sp: ScopedSql) => Promise<T>): Promise<{ value: T; slug: string }> => {
  for (let n = 1; n <= 50; n += 1) {
    const slug = n === 1 ? base : `${base.slice(0, 116)}-${n}`
    try {
      const value = (await tx.savepoint((sp) => write(slug, sp))) as T
      return { value, slug }
    } catch (error) {
      if (!uniqueViolation(error, 'product_slug_key')) throw error
    }
  }
  throw new Error('catalogue: no free web address after 50 tries')
}

export const insertProduct = async (tx: ScopedSql, row: { storeId: string; sellerId: string | null; createdBy: string | null; fields: ProductFields }): Promise<{ id: string; slug: string }> => {
  const f = row.fields
  const { value, slug } = await withFreeSlug(tx, f.slug, async (slug, sp) => {
    const [made] = await sp<{ id: string }[]>`
      insert into product (store_id, seller_id, name, slug, description, product_type, category, visibility, warranty_text, returns_text, seo_title, seo_description, created_by)
      values (${row.storeId}, ${row.sellerId}, ${f.name}, ${slug}, ${f.description}, ${f.productType}, ${f.category}, ${f.visibility}, ${f.warrantyText}, ${f.returnsText}, ${f.seoTitle}, ${f.seoDescription}, ${row.createdBy})
      returning id
    `
    if (!made) throw new Error('catalogue: product insert returned nothing')
    return made.id
  })
  return { id: value, slug }
}

/** The product's own fields, only at the revision the editor read (CATALOG E4); false when it was stale or isn't here. */
export const updateProduct = async (tx: ScopedSql, row: { storeId: string; id: string; revision: number; fields: ProductFields; visibilityChange: boolean }, now: Date): Promise<{ slug: string } | null> => {
  const f = row.fields
  try {
    const { value, slug } = await withFreeSlug(tx, f.slug, async (slug, sp) => {
      const done = await sp`
        update product set name = ${f.name}, slug = ${slug}, description = ${f.description}, product_type = ${f.productType}, category = ${f.category},
          ${row.visibilityChange ? sp`visibility = ${f.visibility},` : sp``}
          warranty_text = ${f.warrantyText}, returns_text = ${f.returnsText}, seo_title = ${f.seoTitle}, seo_description = ${f.seoDescription},
          updated_at = ${now}, revision = revision + 1
        where id = ${row.id} and store_id = ${row.storeId} and revision = ${row.revision} and deleted_at is null
      `
      return done.count
    })
    return value === 1 ? { slug } : null
  } catch (error) {
    if (uniqueViolation(error, 'product_slug_key')) return null
    throw error
  }
}

export const setProductsVisibility = (tx: ScopedSql, storeId: string, ids: readonly string[], visibility: 'visible' | 'hidden', now: Date): Promise<{ id: string; name: string }[]> =>
  tx<{ id: string; name: string }[]>`
    update product set visibility = ${visibility}, updated_at = ${now}, revision = revision + 1
    where store_id = ${storeId} and id = any(${pgArray(ids)}::uuid[]) and deleted_at is null and visibility <> ${visibility}
    returning id, name
  `

/** Soft delete (§7.1): the products and their versions go, orders keep their lines; the web addresses free up. */
export const softDeleteProducts = async (tx: ScopedSql, storeId: string, ids: readonly string[], now: Date): Promise<{ id: string; name: string }[]> => {
  const gone = await tx<{ id: string; name: string }[]>`
    update product set deleted_at = ${now}, updated_at = ${now}, revision = revision + 1
    where store_id = ${storeId} and id = any(${pgArray(ids)}::uuid[]) and deleted_at is null
    returning id, name
  `
  if (gone.length > 0) await tx`update product_version set deleted_at = ${now}, updated_at = ${now} where store_id = ${storeId} and product_id = any(${pgArray(gone.map((g) => g.id))}::uuid[]) and deleted_at is null`
  return gone
}

export const insertOption = async (tx: ScopedSql, storeId: string, productId: string, name: string, position: number): Promise<string> => {
  const [made] = await tx<{ id: string }[]>`insert into product_option (product_id, store_id, name, position) values (${productId}, ${storeId}, ${name}, ${position}) returning id`
  if (!made) throw new Error('catalogue: option insert returned nothing')
  return made.id
}

export const updateOption = async (tx: ScopedSql, id: string, name: string, position: number): Promise<void> => {
  await tx`update product_option set name = ${name}, position = ${position} where id = ${id}`
}

export const deleteOptions = async (tx: ScopedSql, ids: readonly string[]): Promise<void> => {
  if (ids.length > 0) await tx`delete from product_option where id = any(${pgArray(ids)}::uuid[])`
}

export const insertOptionValue = async (tx: ScopedSql, storeId: string, optionId: string, name: string, position: number): Promise<string> => {
  const [made] = await tx<{ id: string }[]>`insert into product_option_value (option_id, store_id, name, position) values (${optionId}, ${storeId}, ${name}, ${position}) returning id`
  if (!made) throw new Error('catalogue: option value insert returned nothing')
  return made.id
}

export const updateOptionValue = async (tx: ScopedSql, id: string, name: string, position: number): Promise<void> => {
  await tx`update product_option_value set name = ${name}, position = ${position} where id = ${id}`
}

export const deleteOptionValues = async (tx: ScopedSql, ids: readonly string[]): Promise<void> => {
  if (ids.length > 0) await tx`delete from product_option_value where id = any(${pgArray(ids)}::uuid[])`
}

export interface VersionFields {
  sku: string | null
  barcode: string | null
  name: string | null
  visibility: 'visible' | 'hidden'
  hsCode: string | null
  customsDescription: string | null
  weightGrams: number | null
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
  cost: { amount: string; currency: string } | null
  trackStock: boolean | null
  continueSelling: boolean | null
  position: number
}

export const insertVersion = async (tx: ScopedSql, storeId: string, productId: string, v: VersionFields): Promise<string> => {
  const [made] = await tx<{ id: string }[]>`
    insert into product_version (product_id, store_id, sku, barcode, name, visibility, hs_code, customs_description, weight_grams, length_mm, width_mm, height_mm,
      cost_amount, cost_currency, track_stock, continue_selling, position)
    values (${productId}, ${storeId}, ${v.sku}, ${v.barcode}, ${v.name}, ${v.visibility}, ${v.hsCode}, ${v.customsDescription}, ${v.weightGrams}, ${v.lengthMm}, ${v.widthMm}, ${v.heightMm},
      ${v.cost?.amount ?? null}::bigint, ${v.cost?.currency ?? null}, ${v.trackStock}, ${v.continueSelling}, ${v.position})
    returning id
  `
  if (!made) throw new Error('catalogue: version insert returned nothing')
  return made.id
}

export const updateVersion = async (tx: ScopedSql, id: string, v: VersionFields, now: Date): Promise<void> => {
  await tx`
    update product_version set sku = ${v.sku}, barcode = ${v.barcode}, name = ${v.name}, visibility = ${v.visibility}, hs_code = ${v.hsCode},
      customs_description = ${v.customsDescription}, weight_grams = ${v.weightGrams}, length_mm = ${v.lengthMm}, width_mm = ${v.widthMm}, height_mm = ${v.heightMm},
      cost_amount = ${v.cost?.amount ?? null}::bigint, cost_currency = ${v.cost?.currency ?? null}, track_stock = ${v.trackStock}, continue_selling = ${v.continueSelling},
      position = ${v.position}, updated_at = ${now}
    where id = ${id}
  `
}

export const softDeleteVersions = async (tx: ScopedSql, ids: readonly string[], now: Date): Promise<void> => {
  if (ids.length > 0) await tx`update product_version set deleted_at = ${now}, updated_at = ${now} where id = any(${pgArray(ids)}::uuid[]) and deleted_at is null`
}

/** The version's choice for every option, replacing what it had. */
export const setVersionChoices = async (tx: ScopedSql, storeId: string, versionId: string, choices: readonly { optionId: string; valueId: string }[]): Promise<void> => {
  await tx`delete from product_version_option_value where version_id = ${versionId}`
  for (const c of choices) {
    await tx`insert into product_version_option_value (version_id, option_id, value_id, store_id) values (${versionId}, ${c.optionId}, ${c.valueId}, ${storeId})`
  }
}

/** The version's prices, one per currency: changed ones updated (their history closes), missing ones removed. */
export const setVersionPrices = async (tx: ScopedSql, storeId: string, versionId: string, prices: readonly { currency: string; amount: string; compareAt: string | null }[]): Promise<void> => {
  const keep = prices.map((p) => p.currency)
  await tx`delete from version_price where version_id = ${versionId} and not (currency = any(${pgArray(keep)}::text[]))`
  for (const p of prices) {
    await tx`
      insert into version_price (version_id, store_id, currency, amount, compare_at_amount)
      values (${versionId}, ${storeId}, ${p.currency}, ${p.amount}::bigint, ${p.compareAt}::bigint)
      on conflict (version_id, currency) do update set amount = excluded.amount, compare_at_amount = excluded.compare_at_amount, source = 'manual'
        where version_price.amount is distinct from excluded.amount or version_price.compare_at_amount is distinct from excluded.compare_at_amount
    `
  }
}

export const skuTakenInStore = (error: unknown): boolean => uniqueViolation(error, 'product_version_sku_key')
