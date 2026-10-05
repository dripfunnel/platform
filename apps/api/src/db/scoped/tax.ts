import type postgres from 'postgres'
import { pgArray, type ScopedSql } from './index'

// Tax setup (migration 0055; SetOps): the store's classes, zones and rates, and its invoice settings, in its scope.

export interface TaxClassRow {
  id: string
  name: string
  tax_code: string | null
  is_default: boolean
  /** Versions on it; the default counts those with no class of their own too. */
  versions: number
}

export interface TaxZoneRow {
  id: string
  name: string
  countries: string[]
  regions: string[]
  rates: { tax_class_id: string; rate_bps: number }[]
}

export interface TaxSetupRow {
  tax_inclusive: boolean
  country: string | null
  region: string | null
  classes: TaxClassRow[]
  zones: TaxZoneRow[]
}

export const selectTaxSetup = async (tx: ScopedSql, storeId: string): Promise<TaxSetupRow | null> =>
  (
    await tx<TaxSetupRow[]>`
      select s.tax_inclusive, s.country, nullif(s.address->>'region', '') as region,
        coalesce((select json_agg(json_build_object('id', c.id, 'name', c.name, 'tax_code', c.tax_code, 'is_default', c.is_default,
            'versions', (select count(*) from product_version v where v.store_id = s.id and v.deleted_at is null and (v.tax_class_id = c.id or (c.is_default and v.tax_class_id is null))))
          order by c.position, c.created_at) from tax_class c where c.store_id = s.id and c.deleted_at is null), '[]'::json) as classes,
        coalesce((select json_agg(json_build_object('id', z.id, 'name', z.name, 'countries', z.countries, 'regions', z.regions,
            'rates', coalesce((select json_agg(json_build_object('tax_class_id', r.tax_class_id, 'rate_bps', r.rate_bps)) from tax_rate r where r.tax_zone_id = z.id), '[]'::json))
          order by z.created_at) from tax_zone z where z.store_id = s.id), '[]'::json) as zones
      from store s where s.id = ${storeId}
    `
  )[0] ?? null

export const setTaxInclusive = async (tx: ScopedSql, inclusive: boolean): Promise<void> => {
  await tx`select set_store_tax_inclusive(${inclusive})`
}

export const insertTaxClass = async (tx: ScopedSql, storeId: string, c: { name: string; taxCode: string | null }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into tax_class (store_id, name, tax_code, position)
    values (${storeId}, ${c.name}, ${c.taxCode}, (select coalesce(max(position) + 1, 0) from tax_class where store_id = ${storeId})) returning id
  `
  if (!row) throw new Error('tax_class: insert returned no row')
  return row.id
}

export const updateTaxClass = async (tx: ScopedSql, storeId: string, id: string, c: { name: string; taxCode: string | null }): Promise<boolean> =>
  (await tx`update tax_class set name = ${c.name}, tax_code = ${c.taxCode} where id = ${id} and store_id = ${storeId} and deleted_at is null`).count > 0

/** SetOps "Make default": new products take it; products already priced keep theirs. */
export const makeDefaultTaxClass = async (tx: ScopedSql, storeId: string, id: string): Promise<boolean> => {
  const exists = await tx`select 1 from tax_class where id = ${id} and store_id = ${storeId} and deleted_at is null for update`
  if (exists.length === 0) return false
  // Versions on the old default by having none move with it in name only, so they keep their rate.
  const [old] = await tx<{ id: string }[]>`select id from tax_class where store_id = ${storeId} and is_default and deleted_at is null`
  if (old && old.id !== id) await tx`update product_version set tax_class_id = ${old.id} where store_id = ${storeId} and tax_class_id is null`
  await tx`update tax_class set is_default = false where store_id = ${storeId} and is_default`
  await tx`update tax_class set is_default = true where id = ${id}`
  return true
}

export const selectTaxClass = async (tx: ScopedSql, storeId: string, id: string): Promise<{ id: string; name: string; is_default: boolean; versions: number } | null> =>
  (
    await tx<{ id: string; name: string; is_default: boolean; versions: number }[]>`
      select c.id, c.name, c.is_default, (select count(*)::int from product_version v where v.tax_class_id = c.id and v.deleted_at is null) as versions
      from tax_class c where c.id = ${id} and c.store_id = ${storeId} and c.deleted_at is null
    `
  )[0] ?? null

export const softDeleteTaxClass = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<void> => {
  await tx`delete from tax_rate where tax_class_id = ${id} and store_id = ${storeId}`
  await tx`update tax_class set deleted_at = ${now} where id = ${id} and store_id = ${storeId}`
}

export const classesOfStore = async (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from tax_class where store_id = ${storeId} and deleted_at is null and id = any(${pgArray(ids)}::uuid[])`)[0]?.n ?? 0

export interface ZoneWrite {
  name: string
  countries: string[]
  regions: string[]
  rates: { taxClassId: string; rateBps: number }[]
}

export const insertTaxZone = async (tx: ScopedSql, storeId: string, z: ZoneWrite): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`insert into tax_zone (store_id, name, countries, regions) values (${storeId}, ${z.name}, ${tx.json(z.countries)}, ${tx.json(z.regions)}) returning id`
  if (!row) throw new Error('tax_zone: insert returned no row')
  return row.id
}

export const updateTaxZone = async (tx: ScopedSql, storeId: string, id: string, z: ZoneWrite): Promise<boolean> =>
  (await tx`update tax_zone set name = ${z.name}, countries = ${tx.json(z.countries)}, regions = ${tx.json(z.regions)} where id = ${id} and store_id = ${storeId}`).count > 0

/** The zone's rates, replacing what it had. */
export const setZoneRates = async (tx: ScopedSql, storeId: string, zoneId: string, rates: ZoneWrite['rates']): Promise<void> => {
  await tx`delete from tax_rate where tax_zone_id = ${zoneId} and store_id = ${storeId}`
  if (rates.length === 0) return
  await tx`
    insert into tax_rate (store_id, tax_class_id, tax_zone_id, rate_bps)
    select ${storeId}, x."taxClassId", ${zoneId}, x."rateBps" from jsonb_to_recordset(${tx.json(rates as unknown as postgres.JSONValue)}) as x("taxClassId" uuid, "rateBps" int)
  `
}

export const deleteTaxZone = async (tx: ScopedSql, storeId: string, id: string): Promise<boolean> => (await tx`delete from tax_zone where id = ${id} and store_id = ${storeId}`).count > 0

/** The versions a cart names, with the class and the price each is taxed at, in the caller's scope. */
export const selectTaxableVersions = (tx: ScopedSql, storeId: string, ids: readonly string[], currency: string): Promise<{ id: string; tax_class_id: string | null; tax_code: string | null; amount: string | null }[]> =>
  tx<{ id: string; tax_class_id: string | null; tax_code: string | null; amount: string | null }[]>`
    select v.id, coalesce(v.tax_class_id, d.id) as tax_class_id, coalesce(c.tax_code, d.tax_code) as tax_code, vp.amount::text as amount
    from product_version v
    left join tax_class c on c.id = v.tax_class_id
    left join tax_class d on d.store_id = v.store_id and d.is_default and d.deleted_at is null
    left join version_price vp on vp.version_id = v.id and vp.currency = ${currency}
    where v.store_id = ${storeId} and v.deleted_at is null and v.id = any(${pgArray(ids)}::uuid[])
  `

export interface InvoiceSettingsRow {
  legal_name: string
  tax_per_line: boolean
  email_with_dispatch: boolean
  footer: string
}

export const selectInvoiceSettings = async (tx: ScopedSql, storeId: string): Promise<InvoiceSettingsRow> =>
  (await tx<InvoiceSettingsRow[]>`select legal_name, tax_per_line, email_with_dispatch, footer from invoice_settings where store_id = ${storeId}`)[0] ?? { legal_name: '', tax_per_line: true, email_with_dispatch: true, footer: '' }

export const saveInvoiceSettings = async (tx: ScopedSql, storeId: string, s: { taxPerLine: boolean; emailWithDispatch: boolean; footer: string }, now: Date): Promise<void> => {
  await tx`
    insert into invoice_settings (store_id, tax_per_line, email_with_dispatch, footer, updated_at) values (${storeId}, ${s.taxPerLine}, ${s.emailWithDispatch}, ${s.footer}, ${now})
    on conflict (store_id) do update set tax_per_line = excluded.tax_per_line, email_with_dispatch = excluded.email_with_dispatch, footer = excluded.footer, updated_at = excluded.updated_at
  `
}

/** What a tax write clashed with; null for anything else. */
export const taxClash = (error: unknown): 'DUPLICATE_NAME' | null =>
  typeof error === 'object' && error !== null && 'constraint_name' in error && (error.constraint_name === 'tax_class_name_key' || error.constraint_name === 'tax_zone_name_key') ? 'DUPLICATE_NAME' : null
