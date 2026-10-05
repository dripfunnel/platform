import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import {
  countStoreProducts,
  deleteMarket,
  insertMarket,
  marketClash,
  moveMarketsOffRemoved,
  selectReadinessFacts,
  selectExclusions,
  selectSellingMarkets,
  saveCurrencies as writeCurrencies,
  saveLanguages as writeLanguages,
  selectLocale,
  selectMarket,
  selectMarkets,
  setExcludedProducts,
  setFallbackMarket,
  setMainLanguage,
  updateMarket,
  type LocaleRow,
} from '#db/scoped/markets'
import { selectRates, type RateRow } from '#db/scoped/rates'
import { conversionExamples, priceInMarket, pricesByCurrency, type ConversionExample, type CurrencyPrice, type StorePricing, type TypedPrice } from './pricing'
import { missingFor, type ReadinessNeed } from './readiness'
import { cleanCurrencies, cleanLanguages, cleanMarket, type CurrencyInput, type MarketInput, type MarketsRefusal } from './rules'

export { offeredLanguages, type CurrencyInput, type MarketInput } from './rules'
export type { ConversionExample, CurrencyPrice } from './pricing'
export type { ReadinessNeed } from './readiness'

export interface MarketReadiness {
  marketId: string
  marketName: string
  missing: ReadinessNeed[]
}
export type { RateRow } from '#db/scoped/rates'
export type { LocaleRow, MarketRow } from '#db/scoped/markets'

// The store's languages, currencies and markets (CATALOG N, O; SetStore, SetMarkets): the merchant side's
// settings. Every write takes the store's markets lock, so a country, path or limit checked holds when it commits.

export const marketsAudit = {
  languagesSaved: 'store.languages_saved',
  mainLanguageChanged: 'store.main_language_changed',
  currenciesSaved: 'store.currencies_saved',
  marketSaved: 'market.saved',
  marketDeleted: 'market.deleted',
  fallbackChanged: 'market.fallback_changed',
} as const

export type MarketsResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: MarketsRefusal | 'NOT_FOUND' | 'STALE_REVISION' | 'CURRENCY_REQUIRED' | 'NOT_OFFERED' | 'PRIMARY_MARKET' | 'COUNTRY_TAKEN' | 'NOT_PARENTS_COUNTRIES' | 'BAD_PARENT' | 'DUPLICATE_NAME' | 'DUPLICATE_PATH' }
  | { ok: false; reason: 'PLAN_LIMIT'; key: 'languages' | 'currencies'; wanted: number }

type Refusal = Exclude<MarketsResult<unknown>, { ok: true }>

class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.reason)
  }
}

export interface MarketsDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** The plan's limit, read before the locked count (saas/entitlements `allowanceFor`); it counts the main one. */
  allowance: (key: 'languages' | 'currencies') => Promise<number>
}

export const createMarketsService = ({ sql, context, actor, activity, facts, now, allowance }: MarketsDeps) => {
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

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<MarketsResult<T>> => {
    try {
      return { ok: true, value: await inScope(async (tx) => {
        await serialise(tx, `store_markets:${storeId}`)
        return work(tx)
      }) }
    } catch (error) {
      if (error instanceof Refused) return error.refusal
      const clash = marketClash(error)
      if (clash) return { ok: false, reason: clash }
      throw error
    }
  }

  const localeOf = async (tx: ScopedSql): Promise<LocaleRow & { pricing_currency: string }> => {
    const locale = await selectLocale(tx, storeId)
    if (!locale) throw new Refused({ ok: false, reason: 'NOT_FOUND' })
    if (!locale.pricing_currency) throw new Refused({ ok: false, reason: 'CURRENCY_REQUIRED' })
    return { ...locale, pricing_currency: locale.pricing_currency }
  }

  const locale = () => inScope((tx) => selectLocale(tx, storeId))

  /** CATALOG N13–N14: a removed language keeps its text, hidden; the main one may change, the rest falling back. */
  const saveLanguages = async (languages: readonly string[], main: string): Promise<MarketsResult<true>> => {
    const cleaned = cleanLanguages(languages, main)
    if (typeof cleaned === 'string') return { ok: false, reason: cleaned }
    const limit = await allowance('languages')
    if (cleaned.languages.length > limit) return { ok: false, reason: 'PLAN_LIMIT', key: 'languages', wanted: cleaned.languages.length }
    return run(async (tx) => {
      const before = await localeOf(tx)
      await writeLanguages(tx, storeId, cleaned.languages)
      if (before.main_language !== cleaned.main) {
        await setMainLanguage(tx, cleaned.main)
        await activity.record(tx, { ...entry(marketsAudit.mainLanguageChanged, { type: 'store', id: storeId, label: 'Main language' }, null), changes: [{ field: 'main_language', before: before.main_language, after: cleaned.main }] })
      }
      await moveMarketsOffRemoved(tx, storeId, { currency: before.pricing_currency, language: cleaned.main }, now())
      await activity.record(tx, entry(marketsAudit.languagesSaved, { type: 'store', id: storeId, label: 'Languages' }, cleaned.languages.join(', ')))
      return true as const
    })
  }

  /** CATALOG O9–O10: a removed currency keeps its prices; switching mode keeps typed prices as overrides. */
  const saveCurrencies = async (input: readonly CurrencyInput[]): Promise<MarketsResult<true>> => {
    const limit = await allowance('currencies')
    // The pricing currency counts as one (the plan page's "1 currency").
    if (input.length + 1 > limit) return { ok: false, reason: 'PLAN_LIMIT', key: 'currencies', wanted: input.length + 1 }
    return run(async (tx) => {
      const before = await localeOf(tx)
      const cleaned = cleanCurrencies(input, before.pricing_currency)
      if (typeof cleaned === 'string') throw new Refused({ ok: false, reason: cleaned })
      await writeCurrencies(tx, storeId, cleaned)
      await moveMarketsOffRemoved(tx, storeId, { currency: before.pricing_currency, language: before.main_language }, now())
      await activity.record(tx, entry(marketsAudit.currenciesSaved, { type: 'store', id: storeId, label: 'Currencies' }, cleaned.map((c) => `${c.currency}:${c.mode}`).join(', ') || 'none'))
      return true as const
    })
  }

  const markets = (window: PageWindow) => inScope((tx) => selectMarkets(tx, storeId, window))
  const market = (id: string) => (isUuid(id) ? inScope((tx) => selectMarket(tx, storeId, id)) : Promise.resolve(null))

  /** SetMarkets' save; the answer is the market's id and revision. */
  const saveMarket = async (id: string | null, revision: number | null, input: MarketInput): Promise<MarketsResult<{ id: string; revision: number }>> => {
    const cleaned = cleanMarket(input)
    if (typeof cleaned === 'string') return { ok: false, reason: cleaned }
    return run(async (tx) => {
      const store = await localeOf(tx)
      const offersCurrency = cleaned.currency === store.pricing_currency || store.currencies.some((c) => c.currency === cleaned.currency && c.status === 'active')
      const offersLanguage = store.languages.some((l) => l.language === cleaned.language && l.status === 'active')
      if (!offersCurrency || !offersLanguage) throw new Refused({ ok: false, reason: 'NOT_OFFERED' })
      if (cleaned.excludedProductIds.length > 0 && (await countStoreProducts(tx, storeId, cleaned.excludedProductIds)) !== cleaned.excludedProductIds.length) throw new Refused({ ok: false, reason: 'NOT_FOUND' })
      const at = now()
      let saved: { id: string; revision: number }
      if (id === null) {
        saved = { id: (await insertMarket(tx, storeId, cleaned, at)).id, revision: 1 }
      } else {
        const existing = isUuid(id) ? await selectMarket(tx, storeId, id, true) : null
        if (!existing) throw new Refused({ ok: false, reason: 'NOT_FOUND' })
        if (revision !== existing.revision) throw new Refused({ ok: false, reason: 'STALE_REVISION' })
        // The primary market is where the store sells first: it can't be switched off or put under another.
        if (existing.is_primary && (!cleaned.active || cleaned.parentId !== null)) throw new Refused({ ok: false, reason: 'PRIMARY_MARKET' })
        // A sub-market can't be its own parent, nor "Everywhere else", which serves whoever no market names.
        if (cleaned.parentId === existing.id || (existing.is_fallback && cleaned.parentId !== null)) throw new Refused({ ok: false, reason: 'BAD_PARENT' })
        if (!(await updateMarket(tx, storeId, existing.id, existing.revision, cleaned, at))) throw new Refused({ ok: false, reason: 'STALE_REVISION' })
        saved = { id: existing.id, revision: existing.revision + 1 }
      }
      await setExcludedProducts(tx, storeId, saved.id, cleaned.excludedProductIds)
      await activity.record(tx, entry(marketsAudit.marketSaved, { type: 'market', id: saved.id, label: cleaned.name }, null))
      return saved
    })
  }

  /** Shoppers there get "Everywhere else" instead; orders already placed keep their market. */
  const removeMarket = (id: string) =>
    run(async (tx) => {
      const existing = isUuid(id) ? await selectMarket(tx, storeId, id, true) : null
      if (!existing) throw new Refused({ ok: false, reason: 'NOT_FOUND' })
      if (existing.is_primary) throw new Refused({ ok: false, reason: 'PRIMARY_MARKET' })
      await deleteMarket(tx, storeId, existing.id, now())
      await activity.record(tx, entry(marketsAudit.marketDeleted, { type: 'market', id: existing.id, label: existing.name }, null))
      return true as const
    })

  /** "Everywhere else": a top-level market for shoppers no market names, or none, who then can't buy. */
  const setFallback = (id: string | null) =>
    run(async (tx) => {
      const chosen = id === null ? null : isUuid(id) ? await selectMarket(tx, storeId, id, true) : null
      if (id !== null && (!chosen || chosen.parent_id !== null)) throw new Refused({ ok: false, reason: 'NOT_FOUND' })
      const was = await setFallbackMarket(tx, storeId, chosen?.id ?? null)
      // The market that now serves everyone else, or, cleared, the one that stopped; nothing changed, no entry.
      const target = chosen ?? was
      if (target) await activity.record(tx, entry(marketsAudit.fallbackChanged, { type: 'market', id: target.id, label: target.name }, chosen ? 'on' : 'off'))
      return true as const
    })

  /** The store's converted currencies' reference rates, for O5's "Rates updated …"; the euro needs none. */
  const rates = () =>
    inScope(async (tx): Promise<RateRow[]> => {
      const store = await selectLocale(tx, storeId)
      const converted = (store?.currencies ?? []).filter((c) => c.status === 'active' && c.mode === 'convert').map((c) => c.currency)
      const wanted = [...new Set([...converted, store?.pricing_currency ?? ''])].filter((c) => c !== '' && c !== 'EUR')
      return [...(await selectRates(tx, wanted)).values()]
    })

  /** What 100 of the pricing currency comes to in the euro and each currency with a rate, under each rounding (O4). */
  const examples = () =>
    inScope(async (tx): Promise<ConversionExample[]> => {
      const store = await selectLocale(tx, storeId)
      if (!store?.pricing_currency) return []
      const rows = [...(await selectRates(tx, [store.pricing_currency, ...store.currencies.map((c) => c.currency)])).values()]
      const perEuro = new Map(rows.map((r) => [r.currency, r.per_euro]))
      return conversionExamples({ pricingCurrency: store.pricing_currency, currencies: [], perEuro }, ['EUR', ...rows.map((r) => r.currency)])
    })

  /**
   * Each version's price in every currency the store sells in, and in a market when one is named (CATALOG O2;
   * the card's "a product priced per market is read back per market"). Null when the market isn't the store's.
   */
  const pricing = (versions: readonly { id: string; prices: readonly TypedPrice[] }[], marketId: string | null) =>
    inScope(async (tx): Promise<{ versionId: string; prices: CurrencyPrice[]; inMarket: CurrencyPrice | null }[] | null> => {
      const store = await selectLocale(tx, storeId)
      if (!store?.pricing_currency) return versions.map((v) => ({ versionId: v.id, prices: [], inMarket: null }))
      const market = marketId === null ? null : isUuid(marketId) ? await selectMarket(tx, storeId, marketId) : null
      if (marketId !== null && !market) return null
      const currencies = store.currencies.filter((c) => c.status === 'active')
      const perEuro = new Map([...(await selectRates(tx, [store.pricing_currency, ...currencies.map((c) => c.currency)])).values()].map((r) => [r.currency, r.per_euro]))
      const setting: StorePricing = { pricingCurrency: store.pricing_currency, currencies, perEuro }
      return versions.map((v) => ({ versionId: v.id, prices: pricesByCurrency(v.prices, setting), inMarket: market ? priceInMarket(v.prices, market, setting) : null }))
    })

  /** Each product's readiness in each market it sells in (CATALOG T2), for a page of products in one go. */
  const readiness = (productIds: readonly string[]) =>
    inScope(async (tx): Promise<Map<string, MarketReadiness[]>> => {
      const out = new Map<string, MarketReadiness[]>()
      if (productIds.length === 0) return out
      const store = await selectLocale(tx, storeId)
      if (!store?.pricing_currency) return out
      const markets = await selectSellingMarkets(tx, storeId)
      const excluded = await selectExclusions(tx, storeId, productIds)
      const currencies = store.currencies.filter((c) => c.status === 'active')
      const perEuro = new Map([...(await selectRates(tx, [store.pricing_currency, ...currencies.map((c) => c.currency)])).values()].map((r) => [r.currency, r.per_euro]))
      const setting: StorePricing = { pricingCurrency: store.pricing_currency, currencies, perEuro }
      for (const row of await selectReadinessFacts(tx, storeId, productIds)) {
        const compliance = new Set(row.compliance)
        const hasCompareAt = row.versions.some((v) => v.prices.some((p) => p.currency === store.pricing_currency && p.compare_at_amount !== null))
        out.set(
          row.id,
          // A market that doesn't sell the product asks nothing of it.
          markets.filter((m) => !excluded.get(m.id)?.has(row.id)).map((m) => ({
            marketId: m.id,
            marketName: m.name,
            missing: missingFor({ productType: row.product_type, priced: row.versions.some((v) => priceInMarket(v.prices, m, setting).amount !== null), hasCompareAt, compliance }, m.countries),
          })),
        )
      }
      return out
    })

  return { locale, rates, examples, pricing, readiness, saveLanguages, saveCurrencies, markets, market, saveMarket, removeMarket, setFallback }
}

export type { MarketsRefusal }
