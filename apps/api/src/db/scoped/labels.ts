import type { CourierProvider, LabelSize, PickupMode } from '#core/couriers'
import { insertAsset } from './catalog'
import type { ScopedSql } from './index'

// Labels and pickups through the store's courier (migration 0130; DATA-MODEL §7.6), in system scope as shipping is: the
// engine has held the order, its lines and the location to the caller's owner before any of these runs.

export interface BookingPlaceRow {
  store_name: string
  store_country: string | null
  /** Store info's street, city, region and postal: the store's own locations leave from it when they have no address. */
  store_address: Record<string, string | undefined>
  contact_email: string | null
  contact_phone: string | null
  warehouse_seller_id: string | null
  warehouse_address: Record<string, string | undefined>
  /** The store's courier, null when it isn't connected (`off` or never). */
  courier: { pickup_mode: PickupMode; label_size: LabelSize } | null
  /** Whose courier account books a to-shopper supplier's labels (DATA-MODEL §4.2 seller.label_account). */
  label_account: 'store' | 'own' | null
}

export const selectBookingPlace = async (tx: ScopedSql, storeId: string, warehouseId: string, provider: CourierProvider, sellerId: string | null): Promise<BookingPlaceRow | null> =>
  (
    await tx<BookingPlaceRow[]>`
      select s.name as store_name, s.country as store_country, s.address as store_address, s.contact_email, s.contact_phone,
        w.seller_id as warehouse_seller_id, w.address as warehouse_address,
        (select json_build_object('pickup_mode', c.pickup_mode, 'label_size', c.label_size) from store_courier c
          where c.store_id = s.id and c.provider = ${provider} and c.role <> 'off') as courier,
        (select label_account from seller where id = ${sellerId}::uuid and store_id = s.id) as label_account
      from store s join warehouse w on w.store_id = s.id and w.id = ${warehouseId}
      where s.id = ${storeId}
    `
  )[0] ?? null

export interface BookingOrderRow {
  currency: string
  email: string | null
  phone: string | null
  shipping_address: { name: string; line1: string; line2: string | null; city: string; region: string | null; postalCode: string | null; country: string; phone: string | null } | null
}

export const selectBookingOrder = async (tx: ScopedSql, orderId: string): Promise<BookingOrderRow | null> =>
  (await tx<BookingOrderRow[]>`select currency, email, phone, shipping_address from "order" where id = ${orderId}`)[0] ?? null

export interface BookingLineRow {
  id: string
  name: string
  sku: string | null
  hs_code: string | null
  unit_amount: string
  weight_grams: number | null
}

export const selectBookingLines = (tx: ScopedSql, orderId: string): Promise<BookingLineRow[]> =>
  tx<BookingLineRow[]>`select id, name, sku, hs_code, unit_amount::text as unit_amount, weight_grams from order_line where order_id = ${orderId}`

/** The label file and the document naming it, the label's supplier owning both so it reads its own (DATA-MODEL §7.6). */
export const insertLabel = async (
  tx: ScopedSql,
  l: { storeId: string; orderId: string; sellerId: string | null; fulfilmentId: string; key: string; mime: string; bytes: number; checksum: string; createdBy: string },
): Promise<string> => {
  const assetId = await insertAsset(tx, { storeId: l.storeId, sellerId: l.sellerId, key: l.key, kind: 'document', mime: l.mime, bytes: l.bytes, width: null, height: null, checksum: l.checksum, createdBy: l.createdBy })
  const [made] = await tx<{ id: string }[]>`
    insert into order_document (order_id, store_id, seller_id, kind, asset_id, fulfilment_id)
    values (${l.orderId}, ${l.storeId}, ${l.sellerId}, 'label', ${assetId}, ${l.fulfilmentId})
    returning id
  `
  return made?.id ?? ''
}

export interface ShipmentToCollectRow {
  id: string
  order_id: string
  number: string
  seller_id: string | null
  kind: string
  warehouse_id: string
  courier_provider: CourierProvider | null
  provider_ref: string | null
  pickup_requested_at: Date | null
}

/** A shipment of this owner, locked, so two asks for its pickup go one after the other. */
export const lockShipmentToCollect = async (tx: ScopedSql, storeId: string, sellerId: string | null, fulfilmentId: string): Promise<ShipmentToCollectRow | null> =>
  (
    await tx<ShipmentToCollectRow[]>`
      select f.id, f.order_id, o.number, f.seller_id, f.kind, f.warehouse_id, f.courier_provider, f.provider_ref, f.pickup_requested_at
      from fulfilment f join "order" o on o.id = f.order_id
      where f.id = ${fulfilmentId} and f.store_id = ${storeId} and f.seller_id is not distinct from ${sellerId}
      for update of f
    `
  )[0] ?? null

export const setPickup = async (tx: ScopedSql, fulfilmentId: string, p: { ref: string | null; date: string | null }, at: Date): Promise<void> => {
  await tx`update fulfilment set pickup_requested_at = ${at}, pickup_ref = ${p.ref}, pickup_date = ${p.date} where id = ${fulfilmentId}`
}

/** A document the caller's scope may read, with its file: a supplier's own labels only (migration 0130's policies). */
export const selectDocumentFile = async (tx: ScopedSql, storeId: string, documentId: string): Promise<{ r2_key: string; mime: string; bytes: number } | null> =>
  (
    await tx<{ r2_key: string; mime: string; bytes: number }[]>`
      select a.r2_key, a.mime, a.bytes from order_document d join asset a on a.id = d.asset_id
      where d.id = ${documentId} and d.store_id = ${storeId}
    `
  )[0] ?? null
