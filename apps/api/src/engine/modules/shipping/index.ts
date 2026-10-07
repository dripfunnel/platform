import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isCountry } from '#core/countries'
import { accountKindOf, CourierRejected, couriersFor, type CourierProvider, type Parcel, type PartnerCouriers } from '#core/couriers'
import { isUuid } from '#core/ids'
import { convert, isCurrency, type Money } from '#core/money'
import type { TenantContext } from '#core/tenancy'
import { selectRates } from '#db/scoped/rates'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import {
  postalCodeListed,
  recordCourierTest,
  replacePostalCodes,
  saveCourier,
  saveShippingRow,
  selectCouriers,
  selectMarketDelivery,
  selectParcelVersions,
  selectShipping,
  type CourierRow,
  type ShippingStoreRow,
} from '#db/scoped/shipping'
import { cleanShipping, defaultWeightGrams, deliveryOptions, labelSizesFor, maxPostalCodes, normalisePostal, type DeliveryOption, type ShippingInput, type ShippingRefusal } from './rules'

export type { DeliveryOption, ShippingInput, ShippingRefusal } from './rules'

// Settings › Shipping (SetOps) and what delivery costs a cart (SAPI 23, #305; DATA-MODEL §7.2): couriers on the
// partner's own accounts (THIRD-PARTY-ACCESS §4). Carts (SAPI 9) price delivery with `quote`.

export const shippingAudit = {
  saved: 'shipping.saved',
  areaReplaced: 'shipping.area_replaced',
  courierConnected: 'courier.connected',
  courierDisconnected: 'courier.disconnected',
  courierPricing: 'courier.pricing_changed',
  courierOptions: 'courier.options_saved',
  couriersTested: 'courier.tested',
} as const

export type ShippingResult<T> = { ok: true; value: T } | { ok: false; reason: ShippingRefusal }

class Refused extends Error {
  constructor(readonly reason: ShippingRefusal) {
    super(reason)
  }
}

export interface ShippingDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** The partner's couriers; null where none can be reached (no accounts yet, #275). */
  couriers: PartnerCouriers | null
}

export type CourierStatus = 'pricing' | 'standby' | 'failed' | 'off'

export interface CourierView {
  provider: CourierProvider
  status: CourierStatus
  /** Whether the partner has the account it goes through; one it hasn't can't be connected. */
  offered: boolean
  pickupMode: CourierRow['pickup_mode']
  labelSize: CourierRow['label_size']
  trackingEmails: boolean
  lastTestedAt: Date | null
  lastTestResult: CourierRow['last_test_result']
}

export interface ShippingSettings {
  revision: number
  savedAt: Date | null
  currency: string
  courierRate: boolean
  flatRate: boolean
  flatAmount: string | null
  pickup: boolean
  pickupHours: string | null
  /** What collection in person shows at checkout: the store's street and city (Store info). */
  pickupAddress: string | null
  freeMode: 'never' | 'always' | 'over'
  freeThresholdAmount: string | null
  areaMode: 'everywhere' | 'list'
  areaFileName: string | null
  areaCount: number
  areaSample: string[]
  labelSizes: readonly CourierRow['label_size'][]
  couriers: CourierView[]
}

export interface QuoteRequest {
  lines: readonly { versionId: string; quantity: number }[]
  shipTo: { country: string; region: string | null; postal: string | null }
  /** The goods' value after discounts, in the cart's currency: the free-delivery threshold reads it. */
  subtotal: Money
  /** The market the cart is in, whose own delivery charge wins when it sells in the cart's currency. */
  marketId: string | null
}

export interface DeliveryQuote {
  currency: string
  /** False when the address is outside where the store delivers: only collection in person is offered. */
  deliverable: boolean
  options: DeliveryOption[]
}

const maxLines = 100
const testParcelGrams = 500

const statusOf = (row: CourierRow | undefined): CourierStatus => (!row || row.role === 'off' ? 'off' : row.last_test_result === 'rejected' ? 'failed' : row.role)

const rateOf = (rates: ReadonlyMap<string, { per_euro: string }>, currency: string) => (currency === 'EUR' ? '1' : (rates.get(currency)?.per_euro ?? null))

/** Money in another currency at the reference rate; null without a rate (CATALOG fact 26). */
const inCurrency = (money: Money, to: string, rates: ReadonlyMap<string, { per_euro: string }>): Money | null => {
  if (money.currency === to) return money
  const from = rateOf(rates, money.currency)
  const target = rateOf(rates, to)
  return from && target ? convert(money, to, from, target) : null
}

export const createShippingService = ({ sql, context, actor, activity, facts, now, couriers }: ShippingDeps) => {
  const { storeId } = context
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const entry = (action: string, target: { type: string; id: string; label: string }, reason: string | null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    target,
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<ShippingResult<T>> => {
    try {
      return {
        ok: true,
        value: await inScope(async (tx) => {
          await serialise(tx, `store_shipping:${storeId}`)
          return work(tx)
        }),
      }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      throw error
    }
  }

  const loadStore = async (tx: ScopedSql): Promise<ShippingStoreRow & { pricing_currency: string }> => {
    const row = await selectShipping(tx, storeId)
    if (!row?.pricing_currency) throw new Refused('NOT_FOUND')
    return { ...row, pricing_currency: row.pricing_currency }
  }

  const viewOf = (row: ShippingStoreRow & { pricing_currency: string }, rows: CourierRow[]): ShippingSettings => {
    const s = row.shipping
    return {
      revision: s?.revision ?? 0,
      savedAt: s?.saved_at ? new Date(s.saved_at) : null,
      currency: s?.currency ?? row.pricing_currency,
      courierRate: s?.courier_enabled ?? false,
      flatRate: s?.flat_enabled ?? false,
      flatAmount: s?.flat_amount ?? null,
      pickup: s?.pickup_enabled ?? false,
      pickupHours: s?.pickup_hours ?? null,
      pickupAddress: [row.street, row.city].filter(Boolean).join(', ') || null,
      freeMode: s?.free_mode ?? 'never',
      freeThresholdAmount: s?.free_threshold_amount ?? null,
      areaMode: s?.area_mode ?? 'everywhere',
      areaFileName: s?.area_file_name ?? null,
      areaCount: row.area_count,
      areaSample: row.area_sample,
      labelSizes: labelSizesFor(row.country),
      couriers: couriersFor(row.country).map((provider) => {
        const found = rows.find((r) => r.provider === provider)
        return {
          provider,
          status: statusOf(found),
          offered: couriers?.accounts.has(accountKindOf(provider)) ?? false,
          pickupMode: found?.pickup_mode ?? 'scheduled',
          labelSize: found?.label_size ?? labelSizesFor(row.country)[0] ?? 'a6',
          trackingEmails: found?.tracking_emails ?? true,
          lastTestedAt: found?.last_tested_at ?? null,
          lastTestResult: found?.last_test_result ?? null,
        }
      }),
    }
  }

  const settings = () => inScope(async (tx) => viewOf(await loadStore(tx), await selectCouriers(tx, storeId)))

  const save = (revision: number, input: ShippingInput) =>
    run(async (tx) => {
      const store = await loadStore(tx)
      const cleaned = cleanShipping(input, store.pricing_currency)
      if (typeof cleaned === 'string') throw new Refused(cleaned)
      if (cleaned.courierEnabled) {
        if (!store.postal) throw new Refused('NO_ADDRESS')
        if (!(await selectCouriers(tx, storeId)).some((c) => c.role === 'pricing')) throw new Refused('NO_COURIER')
      }
      if (cleaned.areaMode === 'list' && store.area_count === 0) throw new Refused('NO_AREA_LIST')
      if (!(await saveShippingRow(tx, storeId, revision, { ...cleaned, currency: store.pricing_currency }, now()))) throw new Refused('STALE')
      const methods = [cleaned.courierEnabled && 'courier', cleaned.flatEnabled && 'flat', cleaned.pickupEnabled && 'pickup'].filter(Boolean).join(', ')
      await activity.record(tx, entry(shippingAudit.saved, { type: 'store', id: storeId, label: 'Shipping' }, `${methods}; free ${cleaned.freeMode}; ${cleaned.areaMode}`))
      return revision + 1
    })

  /** "Upload list": the postcodes the store delivers to, replacing the list; codes not in the store's own country's form are refused. */
  const replaceArea = (fileName: string, codes: readonly string[]) =>
    run(async (tx) => {
      const store = await loadStore(tx)
      const name = fileName.trim()
      if (name === '' || name.length > 200 || !store.country) throw new Refused('INVALID_INPUT')
      if (codes.length > maxPostalCodes) throw new Refused('TOO_MANY')
      const read = codes.map((c) => normalisePostal(store.country ?? '', c))
      if (read.length === 0 || read.some((c) => c === null)) throw new Refused('INVALID_INPUT')
      const unique = [...new Set(read.filter((c): c is string => c !== null))]
      await replacePostalCodes(tx, storeId, unique, name, store.pricing_currency, now())
      await activity.record(tx, entry(shippingAudit.areaReplaced, { type: 'store', id: storeId, label: name }, `${unique.length} codes`))
      return unique.length
    })

  const courierOf = async (tx: ScopedSql, provider: string): Promise<{ provider: CourierProvider; rows: CourierRow[]; row: CourierRow | undefined; country: string | null }> => {
    const store = await loadStore(tx)
    const offered = couriersFor(store.country)
    const found = offered.find((p) => p === provider)
    if (!found) throw new Refused('INVALID_INPUT')
    const rows = await selectCouriers(tx, storeId)
    return { provider: found, rows, row: rows.find((r) => r.provider === found), country: store.country }
  }

  const defaultsOf = (provider: CourierProvider, country: string | null, row: CourierRow | undefined) => ({
    pickupMode: row?.pickup_mode ?? ('scheduled' as const),
    labelSize: row?.label_size ?? labelSizesFor(country)[0] ?? ('a6' as const),
    trackingEmails: row?.tracking_emails ?? true,
    position: Math.max(0, couriersFor(country).indexOf(provider)),
  })

  /** "Connect": on the partner's account, pricing orders when no other courier does, otherwise on standby. */
  const connect = (provider: string) =>
    run(async (tx) => {
      const c = await courierOf(tx, provider)
      if (!couriers?.accounts.has(accountKindOf(c.provider))) throw new Refused('COURIER_NOT_OFFERED')
      if (c.row && c.row.role !== 'off') return statusOf(c.row)
      const role = c.rows.some((r) => r.role === 'pricing') ? ('standby' as const) : ('pricing' as const)
      await saveCourier(tx, storeId, c.provider, { ...defaultsOf(c.provider, c.country, c.row), role }, now())
      await activity.record(tx, entry(shippingAudit.courierConnected, { type: 'courier', id: c.provider, label: c.provider }, role))
      return role
    })

  /** "Use for pricing": this courier quotes checkout; the one that did goes on standby. */
  const usePricing = (provider: string) =>
    run(async (tx) => {
      const c = await courierOf(tx, provider)
      if (!c.row || c.row.role === 'off') throw new Refused('NOT_CONNECTED')
      if (c.row.role === 'pricing') return true as const
      for (const other of c.rows.filter((r) => r.role === 'pricing')) {
        await saveCourier(tx, storeId, other.provider, { ...defaultsOf(other.provider, c.country, other), role: 'standby' }, now())
      }
      await saveCourier(tx, storeId, c.provider, { ...defaultsOf(c.provider, c.country, c.row), role: 'pricing' }, now())
      await activity.record(tx, entry(shippingAudit.courierPricing, { type: 'courier', id: c.provider, label: c.provider }, null))
      return true as const
    })

  /** "Disconnect": the next connected courier takes over pricing (SetOps), the settings kept for a reconnect. */
  const disconnect = (provider: string) =>
    run(async (tx) => {
      const c = await courierOf(tx, provider)
      if (!c.row || c.row.role === 'off') throw new Refused('NOT_CONNECTED')
      await saveCourier(tx, storeId, c.provider, { ...defaultsOf(c.provider, c.country, c.row), role: 'off' }, now())
      const next = c.row.role === 'pricing' ? c.rows.find((r) => r.provider !== c.provider && r.role === 'standby') : undefined
      if (next) await saveCourier(tx, storeId, next.provider, { ...defaultsOf(next.provider, c.country, next), role: 'pricing' }, now())
      await activity.record(tx, entry(shippingAudit.courierDisconnected, { type: 'courier', id: c.provider, label: c.provider }, next ? `${next.provider} prices orders` : null))
      return next?.provider ?? null
    })

  /** "Manage": pickups, label size and tracking emails. */
  const saveOptions = (provider: string, input: { pickupMode: string; labelSize: string; trackingEmails: boolean }) =>
    run(async (tx) => {
      const c = await courierOf(tx, provider)
      if (!c.row || c.row.role === 'off') throw new Refused('NOT_CONNECTED')
      const pickupMode = input.pickupMode === 'scheduled' || input.pickupMode === 'on_request' ? input.pickupMode : null
      const labelSize = labelSizesFor(c.country).find((l) => l === input.labelSize)
      if (!pickupMode || !labelSize) throw new Refused('INVALID_INPUT')
      await saveCourier(tx, storeId, c.provider, { ...defaultsOf(c.provider, c.country, c.row), role: c.row.role, pickupMode, labelSize, trackingEmails: input.trackingEmails }, now())
      await activity.record(tx, entry(shippingAudit.courierOptions, { type: 'courier', id: c.provider, label: c.provider }, null))
      return true as const
    })

  type Outcome = 'ok' | 'rejected' | 'unavailable' | 'unserved'
  const ask = async (provider: CourierProvider, parcel: Parcel) => {
    if (!couriers?.accounts.has(accountKindOf(provider))) return { outcome: 'rejected' as Outcome, rate: null }
    try {
      const rate = await couriers.gateway.quote(provider, parcel)
      return { outcome: (rate ? 'ok' : 'unserved') as Outcome, rate }
    } catch (error) {
      return { outcome: (error instanceof CourierRejected ? 'rejected' : 'unavailable') as Outcome, rate: null }
    }
  }

  /**
   * "Test all": each connected courier quotes a test parcel to the store's own postcode, asked outside any transaction;
   * the answers are kept on the couriers still connected.
   */
  const test = async (): Promise<ShippingResult<{ provider: CourierProvider; result: Outcome; ms: number }[]>> => {
    let before: { country: string; postal: string; currency: string; connected: CourierRow[] }
    try {
      before = await inScope(async (tx) => {
        const store = await loadStore(tx)
        if (!store.country || !store.postal) throw new Refused('NO_ADDRESS')
        return { country: store.country, postal: store.postal, currency: store.pricing_currency, connected: (await selectCouriers(tx, storeId)).filter((r) => r.role !== 'off') }
      })
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      throw error
    }
    const parcel: Parcel = { from: { country: before.country, postal: before.postal }, to: { country: before.country, region: null, postal: before.postal }, weightGrams: testParcelGrams, value: { amount: 0n, currency: before.currency } }
    // At once: each courier is independent, so a slow one adds its own wait and no other's.
    const results = await Promise.all(
      before.connected.map(async (row) => {
        const started = Date.now()
        const { outcome } = await ask(row.provider, parcel)
        return { provider: row.provider, result: outcome, ms: Date.now() - started }
      }),
    )
    return run(async (tx) => {
      const still = (await selectCouriers(tx, storeId)).filter((r) => r.role !== 'off').map((r) => r.provider)
      for (const r of results) if (still.includes(r.provider)) await recordCourierTest(tx, storeId, r.provider, r.result, now())
      await activity.record(tx, entry(shippingAudit.couriersTested, { type: 'store', id: storeId, label: 'Delivery partners' }, results.map((r) => `${r.provider} ${r.result}`).join(', ') || null))
      return results
    })
  }

  /**
   * What delivery costs this cart going to this address, in the cart's currency. One parcel from the store's address
   * (decided on #305): couriers are asked outside any transaction, so a slow one never holds a connection.
   */
  const quote = async (request: QuoteRequest): Promise<ShippingResult<DeliveryQuote>> => {
    const country = request.shipTo.country.trim().toUpperCase()
    const currency = request.subtotal.currency
    const distinct = new Set(request.lines.map((l) => l.versionId.toLowerCase())).size === request.lines.length
    const valid =
      isCountry(country) && isCurrency(currency) && request.subtotal.amount >= 0n && request.lines.length > 0 && request.lines.length <= maxLines && distinct &&
      request.lines.every((l) => isUuid(l.versionId) && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= 10_000) &&
      (request.marketId === null || isUuid(request.marketId)) && (request.shipTo.postal?.length ?? 0) <= 20 && (request.shipTo.region?.length ?? 0) <= 100
    if (!valid) return { ok: false, reason: 'INVALID_INPUT' }
    const postal = request.shipTo.postal ? normalisePostal(country, request.shipTo.postal) : null
    const loaded = await inScope(async (tx) => {
      const store = await selectShipping(tx, storeId)
      const versions = await selectParcelVersions(tx, storeId, request.lines.map((l) => l.versionId.toLowerCase()))
      const market = request.marketId ? await selectMarketDelivery(tx, storeId, request.marketId.toLowerCase()) : null
      const listed = store?.shipping?.area_mode === 'list' && postal !== null && country === store.country ? await postalCodeListed(tx, storeId, postal) : false
      const rates = await selectRates(tx, [...new Set([currency, store?.shipping?.currency ?? currency, 'INR', 'USD'])])
      const rows = await selectCouriers(tx, storeId)
      return { store, versions, market, listed, rates, rows }
    })
    const settings = loaded.store?.shipping
    if (!loaded.store || (request.marketId !== null && !loaded.market)) return { ok: false, reason: 'NOT_FOUND' }
    if (loaded.versions.length !== request.lines.length) return { ok: false, reason: 'NOT_FOUND' }
    // Never saved: nothing to offer yet, which checkout tells the shopper.
    if (!settings?.saved_at) return { ok: true, value: { currency, deliverable: false, options: [] } }
    const deliverable = settings.area_mode === 'everywhere' || loaded.listed
    const weightGrams = request.lines.reduce((sum, l) => sum + (loaded.versions.find((v) => v.id === l.versionId.toLowerCase())?.weight_grams ?? defaultWeightGrams) * l.quantity, 0)
    let courier: Parameters<typeof deliveryOptions>[0]['courier'] = null
    if (deliverable && settings.courier_enabled && loaded.store.country && loaded.store.postal && postal) {
      const parcel: Parcel = { from: { country: loaded.store.country, postal: loaded.store.postal }, to: { country, region: request.shipTo.region?.trim() || null, postal }, weightGrams, value: request.subtotal }
      const order = [...loaded.rows.filter((r) => r.role === 'pricing'), ...loaded.rows.filter((r) => r.role === 'standby')]
      // Asked at once and taken in the fallback order, so a courier that times out never delays the next one's rate.
      const answers = await Promise.all(order.map((row) => ask(row.provider, parcel)))
      for (const [i, row] of order.entries()) {
        const rate = answers[i]?.rate ?? null
        const amount = rate ? inCurrency(rate.amount, currency, loaded.rates) : null
        if (rate && amount) {
          courier = { provider: row.provider, amount, service: rate.service, minDays: rate.minDays, maxDays: rate.maxDays }
          break
        }
      }
    }
    const own = (amount: string | null) => (amount === null ? null : inCurrency({ amount: BigInt(amount), currency: settings.currency }, currency, loaded.rates))
    const marketFlat = loaded.market?.delivery_amount != null && loaded.market.currency === currency ? { amount: BigInt(loaded.market.delivery_amount), currency } : null
    const options = deliveryOptions({
      currency,
      settings: { courierEnabled: settings.courier_enabled, flatEnabled: settings.flat_enabled, pickupEnabled: settings.pickup_enabled, pickupHours: settings.pickup_hours, freeMode: settings.free_mode },
      deliverable,
      courier,
      flat: marketFlat ?? own(settings.flat_amount),
      threshold: own(settings.free_threshold_amount),
      subtotal: request.subtotal,
    })
    return { ok: true, value: { currency, deliverable, options } }
  }

  return { settings, save, replaceArea, connect, usePricing, disconnect, saveOptions, test, quote }
}
