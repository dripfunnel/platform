import type postgres from 'postgres'
import type { ScopedSql } from './index'

// Settings › Store info (migration 0054): the store row's own columns, its legal name in invoice_settings and
// its home country's tax id in tax_registration, each read in the store's scope.

export interface StoreAddress {
  street: string
  city: string
  postal: string
  region: string
}

export interface StoreInfoRow {
  name: string
  description: string
  logo_asset_id: string | null
  address: Partial<StoreAddress>
  contact_email: string | null
  contact_phone: string | null
  country: string | null
  time_zone: string
  unit_system: 'metric' | 'imperial'
  order_prefix: string
  next_order_number: string
  legal_name: string
  tax_id: string | null
}

// Store info's one field shows the home country's registration saved last, so what was typed is what reads back.
const shownFirst = (tx: ScopedSql) => tx`r.updated_at desc, r.created_at desc, r.id`

export const selectStoreInfo = async (tx: ScopedSql, storeId: string): Promise<StoreInfoRow | null> =>
  (
    await tx<StoreInfoRow[]>`
      select s.name, s.description, s.logo_asset_id, s.address, s.contact_email, s.contact_phone, s.country, s.time_zone, s.unit_system,
        s.order_prefix, s.next_order_number::text as next_order_number, coalesce(i.legal_name, '') as legal_name,
        (select r.number from tax_registration r where r.store_id = s.id and r.country = s.country order by ${shownFirst(tx)} limit 1) as tax_id
      from store s left join invoice_settings i on i.store_id = s.id
      where s.id = ${storeId}
    `
  )[0] ?? null

export interface StoreInfoWrite {
  name: string
  description: string
  logoAssetId: string | null
  address: StoreAddress
  contactEmail: string | null
  contactPhone: string | null
  timeZone: string
  unitSystem: 'metric' | 'imperial'
  orderPrefix: string
  nextOrderNumber: number
}

/** Through 0054's definer: the merchant side writes these store columns and no others. */
export const saveStoreInfo = async (tx: ScopedSql, info: StoreInfoWrite): Promise<void> => {
  await tx`select save_store_info(${tx.json({
    name: info.name,
    description: info.description,
    logo_asset_id: info.logoAssetId,
    address: info.address,
    contact_email: info.contactEmail,
    contact_phone: info.contactPhone,
    time_zone: info.timeZone,
    unit_system: info.unitSystem,
    order_prefix: info.orderPrefix,
    next_order_number: info.nextOrderNumber,
  } as unknown as postgres.JSONValue)})`
}

export const saveLegalName = async (tx: ScopedSql, storeId: string, legalName: string, now: Date): Promise<void> => {
  await tx`
    insert into invoice_settings (store_id, legal_name, updated_at) values (${storeId}, ${legalName}, ${now})
    on conflict (store_id) do update set legal_name = excluded.legal_name, updated_at = excluded.updated_at
  `
}

/**
 * The home country's registration of the kind the id is (CATALOG fact 36 allows several, a US store's EIN and its
 * sales-tax permit): that kind's row updated or added, the others kept; cleared, the one Store info shows goes.
 */
export const saveHomeTaxId = async (tx: ScopedSql, storeId: string, country: string, registration: { kind: 'gst' | 'ein' | 'sales_tax_permit' | 'vat'; number: string } | null): Promise<void> => {
  if (registration) {
    await tx`
      insert into tax_registration (store_id, country, kind, number, updated_at) values (${storeId}, ${country}, ${registration.kind}, ${registration.number}, clock_timestamp())
      on conflict (store_id, country, kind) do update set number = excluded.number, updated_at = excluded.updated_at
    `
    return
  }
  await tx`
    delete from tax_registration where id = (select r.id from tax_registration r where r.store_id = ${storeId} and r.country = ${country} order by ${shownFirst(tx)} limit 1)
  `
}

/** What save_store_info refused: a logo not the store's own image, or an order number lower than the next one. */
export const storeInfoRefused = (error: unknown): 'INVALID_LOGO' | 'ORDER_NUMBER_DOWN' | null =>
  !(error instanceof Error) ? null : error.message.includes("the store's own image") ? 'INVALID_LOGO' : error.message.includes('order numbers only go up') ? 'ORDER_NUMBER_DOWN' : null
