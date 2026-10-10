import { CourierRejected, CourierUnavailable, type LabelAddress, type LabelRequest } from '#core/couriers'
import type { BookingLineRow, BookingOrderRow, BookingPlaceRow } from '#db/scoped/labels'
import { defaultWeightGrams } from '#engine/modules/shipping/index'

// What a label needs from the order, the location and the store (SAPI 12; FIRST-RELEASE §6 "book a label"), and what a
// courier's failure means to the caller. The courier calls themselves are the adapters' (integrations/couriers).

const field = (value: string | null | undefined) => {
  const v = value?.trim() ?? ''
  return v.length > 0 ? v : null
}

/**
 * Where the parcel leaves from: the location's own address, or for one of the store's locations with none, Store info's
 * (which quotes already price from); null when neither is whole.
 */
export const fromAddressOf = (place: BookingPlaceRow, warehouseId: string): (LabelAddress & { locationId: string }) | null => {
  const w = place.warehouse_address
  const own = { line1: field(w['line1']), line2: field(w['line2']), city: field(w['city']), region: field(w['region']), postal: field(w['postalCode']), country: field(w['country']) }
  const s = place.store_address
  const store = { line1: field(s['street']), line2: null, city: field(s['city']), region: field(s['region']), postal: field(s['postal']), country: field(place.store_country) }
  const a = own.line1 && own.city && own.postal && own.country ? own : place.warehouse_seller_id === null ? store : own
  if (!a.line1 || !a.city || !a.postal || !a.country) return null
  return { locationId: warehouseId, name: place.store_name, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postal: a.postal, country: a.country, phone: field(place.contact_phone), email: field(place.contact_email) }
}

/** Where it goes: the order's delivery address, with the shopper's number and email for the courier's updates. */
export const toAddressOf = (order: BookingOrderRow): LabelAddress | null => {
  const a = order.shipping_address
  const postal = field(a?.postalCode)
  if (!a || !postal || !field(a.line1) || !field(a.city)) return null
  return { name: a.name, line1: a.line1, line2: field(a.line2), city: a.city, region: field(a.region), postal, country: a.country, phone: field(a.phone) ?? field(order.phone), email: field(order.email) }
}

/** The parcel: the picked units at what the shopper paid for each, weighed as quotes weigh them. */
export const parcelOf = (lines: readonly BookingLineRow[], picked: readonly { lineId: string; quantity: number }[]): Pick<LabelRequest, 'items' | 'weightGrams'> & { amount: bigint } => {
  const byId = new Map(lines.map((l) => [l.id, l]))
  const items = picked.flatMap((p) => {
    const l = byId.get(p.lineId)
    return l ? [{ line: l, quantity: p.quantity }] : []
  })
  return {
    items: items.map(({ line, quantity }) => ({ name: line.name, sku: line.sku, quantity, unitAmount: BigInt(line.unit_amount), hsCode: line.hs_code })),
    weightGrams: items.reduce((sum, { line, quantity }) => sum + (line.weight_grams && line.weight_grams > 0 ? line.weight_grams : defaultWeightGrams) * quantity, 0),
    amount: items.reduce((sum, { line, quantity }) => sum + BigInt(line.unit_amount) * BigInt(quantity), 0n),
  }
}

export type CourierFailure = 'COURIER_REJECTED' | 'COURIER_UNAVAILABLE'

/** A courier's refusal of the partner's account, or no answer; null for anything else, which is ours and rethrown. */
export const courierFailureOf = (error: unknown): CourierFailure | null =>
  error instanceof CourierRejected ? 'COURIER_REJECTED' : error instanceof CourierUnavailable || (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) ? 'COURIER_UNAVAILABLE' : null

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const checksumOf = async (bytes: Uint8Array<ArrayBuffer>) => hex(await crypto.subtle.digest('SHA-256', bytes))
