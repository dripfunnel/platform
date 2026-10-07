import type { CourierProvider } from '#core/couriers'
import { pgArray, type ScopedSql } from './index'

// Settings › Shipping (migration 0063; SetOps): what the shopper pays, when it's free, where the store delivers and its
// couriers, in the store's scope.

export interface ShippingRow {
  courier_enabled: boolean
  flat_enabled: boolean
  flat_amount: string | null
  pickup_enabled: boolean
  pickup_hours: string | null
  free_mode: 'never' | 'always' | 'over'
  free_threshold_amount: string | null
  currency: string
  area_mode: 'everywhere' | 'list'
  area_file_name: string | null
  saved_at: Date | null
  revision: number
}

export interface ShippingStoreRow {
  country: string | null
  postal: string | null
  street: string | null
  city: string | null
  pricing_currency: string | null
  shipping: ShippingRow | null
  area_count: number
  area_sample: string[]
}

export const selectShipping = async (tx: ScopedSql, storeId: string): Promise<ShippingStoreRow | null> =>
  (
    await tx<ShippingStoreRow[]>`
      select s.country, nullif(s.address->>'postal', '') as postal, nullif(s.address->>'street', '') as street, nullif(s.address->>'city', '') as city,
        s.pricing_currency::text as pricing_currency,
        (select row_to_json(x) from (
          select h.courier_enabled, h.flat_enabled, h.flat_amount::text as flat_amount, h.pickup_enabled, h.pickup_hours, h.free_mode,
            h.free_threshold_amount::text as free_threshold_amount, h.currency, h.area_mode, h.area_file_name, h.saved_at, h.revision
          from store_shipping h where h.store_id = s.id) x) as shipping,
        (select count(*)::int from delivery_postal_code d where d.store_id = s.id) as area_count,
        coalesce((select json_agg(d.code) from (select code from delivery_postal_code where store_id = s.id order by code limit 3) d), '[]'::json) as area_sample
      from store s where s.id = ${storeId}
    `
  )[0] ?? null

export interface ShippingWrite {
  courierEnabled: boolean
  flatEnabled: boolean
  flatAmount: bigint | null
  pickupEnabled: boolean
  pickupHours: string | null
  freeMode: 'never' | 'always' | 'over'
  freeThresholdAmount: bigint | null
  currency: string
  areaMode: 'everywhere' | 'list'
}

/** At the revision read (0 before the first save); false when someone saved since. */
export const saveShippingRow = async (tx: ScopedSql, storeId: string, revision: number, w: ShippingWrite, now: Date): Promise<boolean> =>
  (
    await tx`
      insert into store_shipping (store_id, courier_enabled, flat_enabled, flat_amount, pickup_enabled, pickup_hours, free_mode, free_threshold_amount, currency, area_mode, saved_at, revision, updated_at)
      values (${storeId}, ${w.courierEnabled}, ${w.flatEnabled}, ${w.flatAmount === null ? null : w.flatAmount.toString()}, ${w.pickupEnabled}, ${w.pickupHours},
        ${w.freeMode}, ${w.freeThresholdAmount === null ? null : w.freeThresholdAmount.toString()}, ${w.currency}, ${w.areaMode}, ${now}, 1, ${now})
      on conflict (store_id) do update set courier_enabled = excluded.courier_enabled, flat_enabled = excluded.flat_enabled, flat_amount = excluded.flat_amount,
        pickup_enabled = excluded.pickup_enabled, pickup_hours = excluded.pickup_hours, free_mode = excluded.free_mode,
        free_threshold_amount = excluded.free_threshold_amount, currency = excluded.currency, area_mode = excluded.area_mode,
        saved_at = coalesce(store_shipping.saved_at, excluded.saved_at), revision = store_shipping.revision + 1, updated_at = excluded.updated_at
      where store_shipping.revision = ${revision}
    `
  ).count > 0

/** The postcodes the store delivers to, replacing the list it had, named after the file they came from. */
export const replacePostalCodes = async (tx: ScopedSql, storeId: string, codes: readonly string[], fileName: string, currency: string, now: Date): Promise<void> => {
  await tx`delete from delivery_postal_code where store_id = ${storeId}`
  if (codes.length > 0) await tx`insert into delivery_postal_code (store_id, code) select ${storeId}, unnest(${pgArray(codes)}::text[])`
  // The list is kept beside settings not yet saved; the row's first save keeps it.
  await tx`
    insert into store_shipping (store_id, currency, area_file_name, updated_at) values (${storeId}, ${currency}, ${fileName}, ${now})
    on conflict (store_id) do update set area_file_name = excluded.area_file_name, updated_at = excluded.updated_at
  `
}

/** Through store_delivers_to (migration 0063), so a shopper's quote never reads the list. */
export const postalCodeListed = async (tx: ScopedSql, code: string): Promise<boolean> =>
  (await tx<{ listed: boolean }[]>`select store_delivers_to(${code}) as listed`)[0]?.listed === true

export interface QuoteSettingsRow {
  country: string | null
  postal: string | null
  shipping: Pick<ShippingRow, 'courier_enabled' | 'flat_enabled' | 'flat_amount' | 'pickup_enabled' | 'pickup_hours' | 'free_mode' | 'free_threshold_amount' | 'currency' | 'area_mode' | 'saved_at'> | null
}

/** What a quote reads, and nothing more: a shopper's cart prices delivery with it (SAPI 9). */
export const selectQuoteSettings = async (tx: ScopedSql, storeId: string): Promise<QuoteSettingsRow | null> =>
  (
    await tx<QuoteSettingsRow[]>`
      select s.country, nullif(s.address->>'postal', '') as postal,
        (select row_to_json(x) from (
          select h.courier_enabled, h.flat_enabled, h.flat_amount::text as flat_amount, h.pickup_enabled, h.pickup_hours, h.free_mode,
            h.free_threshold_amount::text as free_threshold_amount, h.currency, h.area_mode, h.saved_at
          from store_shipping h where h.store_id = s.id) x) as shipping
      from store s where s.id = ${storeId}
    `
  )[0] ?? null

export const selectQuoteCouriers = (tx: ScopedSql, storeId: string): Promise<Pick<CourierRow, 'provider' | 'role'>[]> =>
  tx<Pick<CourierRow, 'provider' | 'role'>[]>`select provider, role from store_courier where store_id = ${storeId} and role <> 'off' order by position, provider`

export interface CourierRow {
  provider: CourierProvider
  role: 'pricing' | 'standby' | 'off'
  pickup_mode: 'scheduled' | 'on_request'
  label_size: 'a6' | 'a4' | '4x6' | 'letter'
  tracking_emails: boolean
  position: number
  last_tested_at: Date | null
  last_test_result: 'ok' | 'rejected' | 'unavailable' | 'unserved' | null
}

export const selectCouriers = (tx: ScopedSql, storeId: string): Promise<CourierRow[]> =>
  tx<CourierRow[]>`
    select provider, role, pickup_mode, label_size, tracking_emails, position, last_tested_at, last_test_result
    from store_courier where store_id = ${storeId} order by position, provider
  `

export interface CourierWrite {
  role: CourierRow['role']
  pickupMode: CourierRow['pickup_mode']
  labelSize: CourierRow['label_size']
  trackingEmails: boolean
  position: number
}

/** One courier's settings; the pricing one is unique per store, so a caller moves the old one to standby first. */
export const saveCourier = async (tx: ScopedSql, storeId: string, provider: CourierProvider, w: CourierWrite, now: Date): Promise<void> => {
  await tx`
    insert into store_courier (store_id, provider, role, pickup_mode, label_size, tracking_emails, position, updated_at)
    values (${storeId}, ${provider}, ${w.role}, ${w.pickupMode}, ${w.labelSize}, ${w.trackingEmails}, ${w.position}, ${now})
    on conflict (store_id, provider) do update set role = excluded.role, pickup_mode = excluded.pickup_mode, label_size = excluded.label_size,
      tracking_emails = excluded.tracking_emails, position = excluded.position, updated_at = excluded.updated_at
  `
}

/** The courier's rate off, at a new revision; false when it already was. */
export const courierRateOff = async (tx: ScopedSql, storeId: string, now: Date): Promise<boolean> =>
  (await tx`update store_shipping set courier_enabled = false, revision = revision + 1, updated_at = ${now} where store_id = ${storeId} and courier_enabled`).count > 0

export const recordCourierTest = async (tx: ScopedSql, storeId: string, provider: CourierProvider, result: NonNullable<CourierRow['last_test_result']>, now: Date): Promise<void> => {
  await tx`update store_courier set last_tested_at = ${now}, last_test_result = ${result} where store_id = ${storeId} and provider = ${provider}`
}

export interface ParcelVersionRow {
  id: string
  weight_grams: number | null
}

/** The versions a cart names, for its parcel's weight, in the caller's scope. */
export const selectParcelVersions = (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<ParcelVersionRow[]> =>
  tx<ParcelVersionRow[]>`select id, weight_grams from product_version where store_id = ${storeId} and deleted_at is null and id = any(${pgArray(ids)}::uuid[])`

export const selectMarketDelivery = async (tx: ScopedSql, storeId: string, marketId: string): Promise<{ currency: string; delivery_amount: string | null } | null> =>
  (await tx<{ currency: string; delivery_amount: string | null }[]>`
    select currency::text as currency, delivery_amount::text as delivery_amount from market where id = ${marketId} and store_id = ${storeId} and deleted_at is null and status = 'active'
  `)[0] ?? null
