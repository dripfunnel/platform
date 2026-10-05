import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isCountry } from '#core/countries'
import { isUuid } from '#core/ids'
import type { TenantContext } from '#core/tenancy'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import {
  classesOfStore,
  deleteTaxZone,
  insertTaxClass,
  insertTaxZone,
  makeDefaultTaxClass,
  saveInvoiceSettings,
  selectInvoiceSettings,
  selectTaxableVersions,
  selectTaxClass,
  selectTaxSetup,
  setTaxInclusive,
  setZoneRates,
  softDeleteTaxClass,
  taxClash,
  updateTaxClass,
  updateTaxZone,
  type TaxSetupRow,
} from '#db/scoped/tax'
import { computeTax, type LineTax, type ShipTo, type TaxSetting } from './compute'

export type { InvoiceSettingsRow, TaxSetupRow } from '#db/scoped/tax'
export type { LineTax } from './compute'

// Settings › Tax setup (SetOps; CATALOG facts 37–38, T3–T4) and tax on a cart: the store's own rates, or Stripe
// Tax on the merchant's connected Stripe account for a US address (decided on #284, #337).

export const taxAudit = {
  inclusiveChanged: 'tax.inclusive_changed',
  classSaved: 'tax_class.saved',
  classDeleted: 'tax_class.deleted',
  zoneSaved: 'tax_zone.saved',
  zoneDeleted: 'tax_zone.deleted',
  invoiceSettingsSaved: 'invoice_settings.saved',
} as const

export type TaxRefusal = 'NOT_FOUND' | 'INVALID_INPUT' | 'DUPLICATE_NAME' | 'DEFAULT_CLASS' | 'CLASS_IN_USE' | 'PRICE_REQUIRED' | 'TOO_MANY' | 'TAX_UNAVAILABLE'
export type TaxResult<T> = { ok: true; value: T } | { ok: false; reason: TaxRefusal }

class Refused extends Error {
  constructor(readonly reason: TaxRefusal) {
    super(reason)
  }
}

/** Stripe Tax for a US address, when the store has connected its Stripe account (SAPI 10 connects it). */
export interface StripeTaxDeps {
  accountId: () => Promise<string | null>
  calculate: (request: { accountId: string; currency: string; inclusive: boolean; shipTo: { country: string; region: string | null; postal: string | null }; lines: { reference: string; amount: bigint; taxCode: string | null }[] }) => Promise<{ total: bigint; lines: { reference: string; amount: bigint }[] }>
}

export interface TaxDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  stripe: StripeTaxDeps | null
}

export interface CartLine {
  versionId: string
  quantity: number
}

export interface CartTax {
  currency: string
  inclusive: boolean
  /** Who worked it out: the store's own rates, or Stripe Tax. */
  source: 'rates' | 'stripe'
  lines: (LineTax & { quantity: number; lineAmount: bigint })[]
  total: bigint
}

const maxLines = 100
// Each store's own list, read whole by Tax setup, stays short (AGENTS.md: every list has a maximum).
export const maxTaxClasses = 50
export const maxTaxZones = 100

export const createTaxService = ({ sql, context, actor, activity, facts, now, stripe }: TaxDeps) => {
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

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<TaxResult<T>> => {
    try {
      return {
        ok: true,
        value: await inScope(async (tx) => {
          await serialise(tx, `store_tax:${storeId}`)
          return work(tx)
        }),
      }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      if (taxClash(error)) return { ok: false, reason: 'DUPLICATE_NAME' }
      throw error
    }
  }

  const setup = () => inScope((tx) => selectTaxSetup(tx, storeId))

  const setInclusive = (inclusive: boolean) =>
    run(async (tx) => {
      await setTaxInclusive(tx, inclusive)
      await activity.record(tx, entry(taxAudit.inclusiveChanged, { type: 'store', id: storeId, label: 'Prices include tax' }, inclusive ? 'included' : 'added'))
      return true as const
    })

  const cleanClass = (input: { name: string; taxCode?: string | null | undefined }) => {
    const name = input.name.trim()
    const taxCode = input.taxCode?.trim() || null
    if (name === '' || name.length > 60 || (taxCode !== null && !/^txcd_[0-9]{8}$/.test(taxCode))) throw new Refused('INVALID_INPUT')
    return { name, taxCode }
  }

  const saveClass = (id: string | null, input: { name: string; taxCode?: string | null | undefined; isDefault?: boolean | null | undefined }) =>
    run(async (tx) => {
      const cleaned = cleanClass(input)
      let saved: string
      if (id === null && ((await selectTaxSetup(tx, storeId))?.classes.length ?? 0) >= maxTaxClasses) throw new Refused('TOO_MANY')
      if (id === null) saved = await insertTaxClass(tx, storeId, cleaned)
      else {
        if (!isUuid(id) || !(await updateTaxClass(tx, storeId, id, cleaned))) throw new Refused('NOT_FOUND')
        saved = id
      }
      if (input.isDefault) await makeDefaultTaxClass(tx, storeId, saved)
      await activity.record(tx, entry(taxAudit.classSaved, { type: 'tax_class', id: saved, label: cleaned.name }, input.isDefault ? 'default' : null))
      return saved
    })

  /** Never the default, nor one a version is on: products keep the class they were priced with. */
  const deleteClass = (id: string) =>
    run(async (tx) => {
      const found = isUuid(id) ? await selectTaxClass(tx, storeId, id) : null
      if (!found) throw new Refused('NOT_FOUND')
      if (found.is_default) throw new Refused('DEFAULT_CLASS')
      if (found.versions > 0) throw new Refused('CLASS_IN_USE')
      await softDeleteTaxClass(tx, storeId, id, now())
      await activity.record(tx, entry(taxAudit.classDeleted, { type: 'tax_class', id, label: found.name }, null))
      return true as const
    })

  const saveZone = (id: string | null, input: { name: string; countries: readonly string[]; regions?: readonly string[] | null | undefined; rates: readonly { taxClassId: string; rateBps: number }[] }) =>
    run(async (tx) => {
      const name = input.name.trim()
      const countries = [...new Set(input.countries.map((c) => c.trim().toUpperCase()))]
      const regions = [...new Set((input.regions ?? []).map((r) => r.trim()).filter((r) => r !== ''))]
      const rates = input.rates.map((r) => ({ taxClassId: r.taxClassId.toLowerCase(), rateBps: r.rateBps }))
      const valid =
        name !== '' && name.length <= 60 && countries.length > 0 && countries.every(isCountry) && regions.length <= 100 && regions.every((r) => r.length <= 100) &&
        rates.every((r) => isUuid(r.taxClassId) && Number.isInteger(r.rateBps) && r.rateBps >= 0 && r.rateBps <= 10_000) &&
        new Set(rates.map((r) => r.taxClassId)).size === rates.length
      if (!valid) throw new Refused('INVALID_INPUT')
      if (rates.length > 0 && (await classesOfStore(tx, storeId, rates.map((r) => r.taxClassId))) !== rates.length) throw new Refused('NOT_FOUND')
      const zone = { name, countries, regions, rates }
      let saved: string
      if (id === null && ((await selectTaxSetup(tx, storeId))?.zones.length ?? 0) >= maxTaxZones) throw new Refused('TOO_MANY')
      if (id === null) saved = await insertTaxZone(tx, storeId, zone)
      else {
        if (!isUuid(id) || !(await updateTaxZone(tx, storeId, id, zone))) throw new Refused('NOT_FOUND')
        saved = id
      }
      await setZoneRates(tx, storeId, saved, rates)
      await activity.record(tx, entry(taxAudit.zoneSaved, { type: 'tax_zone', id: saved, label: name }, null))
      return saved
    })

  const deleteZone = (id: string) =>
    run(async (tx) => {
      const setupRow = await selectTaxSetup(tx, storeId)
      const zone = setupRow?.zones.find((z) => z.id === id)
      if (!zone || !(await deleteTaxZone(tx, storeId, id))) throw new Refused('NOT_FOUND')
      await activity.record(tx, entry(taxAudit.zoneDeleted, { type: 'tax_zone', id, label: zone.name }, null))
      return true as const
    })

  const invoiceSettings = () => inScope((tx) => selectInvoiceSettings(tx, storeId))

  /** New invoices follow new settings; issued ones are never rewritten (SetOps). */
  const saveInvoice = (input: { taxPerLine: boolean; emailWithDispatch: boolean; footer?: string | null | undefined }) =>
    run(async (tx) => {
      const footer = (input.footer ?? '').trim()
      if (footer.length > 500) throw new Refused('INVALID_INPUT')
      await saveInvoiceSettings(tx, storeId, { taxPerLine: input.taxPerLine, emailWithDispatch: input.emailWithDispatch, footer }, now())
      await activity.record(tx, entry(taxAudit.invoiceSettingsSaved, { type: 'store', id: storeId, label: 'Invoice settings' }, null))
      return true as const
    })

  /**
   * The tax on a cart's lines going to an address, in the pricing currency: Stripe Tax for a US address when
   * the store's Stripe account is connected, its own rates otherwise. Carts (SAPI 9) price with it.
   */
  const quote = async (cart: readonly CartLine[], shipTo: ShipTo & { postal: string | null }): Promise<TaxResult<CartTax>> => {
    // One line per version, as a cart holds them: Stripe answers per line by the version's id.
    const distinct = new Set(cart.map((l) => l.versionId.toLowerCase())).size === cart.length
    if (cart.length === 0 || cart.length > maxLines || !distinct || !isCountry(shipTo.country) || !cart.every((l) => isUuid(l.versionId) && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= 10_000)) {
      return { ok: false, reason: 'INVALID_INPUT' }
    }
    const loaded = await inScope(async (tx) => {
      const setting = await selectTaxSetup(tx, storeId)
      const [currency] = await tx<{ c: string | null }[]>`select store_pricing_currency() as c`
      const versions = currency?.c ? await selectTaxableVersions(tx, storeId, cart.map((l) => l.versionId.toLowerCase()), currency.c) : []
      return { setting, currency: currency?.c ?? null, versions }
    })
    if (!loaded.setting || !loaded.currency) return { ok: false, reason: 'NOT_FOUND' }
    const lines = cart.map((l) => ({ line: l, version: loaded.versions.find((v) => v.id === l.versionId.toLowerCase()) }))
    if (lines.some((l) => !l.version)) return { ok: false, reason: 'NOT_FOUND' }
    if (lines.some((l) => l.version?.amount === null)) return { ok: false, reason: 'PRICE_REQUIRED' }
    const priced = lines.map(({ line, version }) => ({ id: line.versionId.toLowerCase(), quantity: line.quantity, lineAmount: BigInt(version?.amount ?? '0') * BigInt(line.quantity), taxClassId: version?.tax_class_id ?? null, taxCode: version?.tax_code ?? null }))
    const setting = loaded.setting
    const accountId = shipTo.country === 'US' && stripe ? await stripe.accountId() : null
    if (stripe && accountId) {
      // Stripe down or refusing is a tax the cart can't know yet, never a guess at the store's own rates.
      let result: Awaited<ReturnType<StripeTaxDeps['calculate']>>
      try {
        result = await stripe.calculate({ accountId, currency: loaded.currency, inclusive: setting.tax_inclusive, shipTo, lines: priced.map((p) => ({ reference: p.id, amount: p.lineAmount, taxCode: p.taxCode })) })
      } catch {
        return { ok: false, reason: 'TAX_UNAVAILABLE' }
      }
      return {
        ok: true,
        value: {
          currency: loaded.currency,
          inclusive: setting.tax_inclusive,
          source: 'stripe',
          lines: priced.map((p) => {
            const amount = result.lines.find((l) => l.reference === p.id)?.amount ?? 0n
            return { id: p.id, rateBps: 0, amount, components: amount === 0n ? [] : [{ name: 'Tax' as const, rateBps: 0, amount }], quantity: p.quantity, lineAmount: p.lineAmount }
          }),
          total: result.total,
        },
      }
    }
    const computed = computeTax(priced.map((p) => ({ id: p.id, amount: p.lineAmount, taxClassId: p.taxClassId })), shipTo, settingOf(setting))
    return {
      ok: true,
      value: { currency: loaded.currency, inclusive: setting.tax_inclusive, source: 'rates', lines: computed.lines.map((l, i) => ({ ...l, quantity: priced[i]?.quantity ?? 0, lineAmount: priced[i]?.lineAmount ?? 0n })), total: computed.total },
    }
  }

  return { setup, setInclusive, saveClass, deleteClass, saveZone, deleteZone, invoiceSettings, saveInvoice, quote }
}

const settingOf = (row: TaxSetupRow): TaxSetting => ({
  inclusive: row.tax_inclusive,
  defaultClassId: row.classes.find((c) => c.is_default)?.id ?? null,
  storeCountry: row.country,
  storeRegion: row.region,
  rates: row.zones.flatMap((z) => z.rates.map((r) => ({ taxClassId: r.tax_class_id, countries: z.countries, regions: z.regions, rateBps: r.rate_bps }))),
})
