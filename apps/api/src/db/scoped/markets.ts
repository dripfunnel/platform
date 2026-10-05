import type postgres from 'postgres'
import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

// The store's languages, currencies and markets (DATA-MODEL §7.2, migration 0051): the merchant side's, in
// the store's scope. The main language and the pricing currency are store columns, read here.

export type CurrencyMode = 'manual' | 'convert'
export type Rounding = 'none' | 'nearest' | 'ends-99'

export interface LocaleRow {
  main_language: string
  pricing_currency: string | null
  languages: { language: string; status: 'active' | 'removed' }[]
  currencies: { currency: string; mode: CurrencyMode; rounding: Rounding; status: 'active' | 'removed' }[]
}

export const selectLocale = async (tx: ScopedSql, storeId: string): Promise<LocaleRow | null> =>
  (
    await tx<LocaleRow[]>`
      select s.main_language, s.pricing_currency::text as pricing_currency,
        coalesce((select json_agg(json_build_object('language', l.language, 'status', l.status) order by l.position, l.created_at)
          from store_language l where l.store_id = s.id), '[]'::json) as languages,
        coalesce((select json_agg(json_build_object('currency', c.currency::text, 'mode', c.mode, 'rounding', c.rounding, 'status', c.status) order by c.position, c.created_at)
          from store_currency c where c.store_id = s.id), '[]'::json) as currencies
      from store s where s.id = ${storeId}
    `
  )[0] ?? null

/** Each language offered, in order; one not listed is kept, removed (CATALOG N13). */
export const saveLanguages = async (tx: ScopedSql, storeId: string, languages: readonly string[]): Promise<void> => {
  await tx`
    insert into store_language (store_id, language, status, position)
    select ${storeId}, l, 'active', p - 1 from unnest(${pgArray(languages)}::text[]) with ordinality as x(l, p)
    on conflict (store_id, language) do update set status = 'active', position = excluded.position
  `
  await tx`update store_language set status = 'removed' where store_id = ${storeId} and status = 'active' and not (language = any(${pgArray(languages)}::text[]))`
}

export const setMainLanguage = async (tx: ScopedSql, language: string): Promise<void> => {
  await tx`select set_store_main_language(${language})`
}

export interface CurrencyWrite {
  currency: string
  mode: CurrencyMode
  rounding: Rounding
}

/** Each extra currency, in order; one not listed keeps its prices, unused (CATALOG O9). */
export const saveCurrencies = async (tx: ScopedSql, storeId: string, currencies: readonly CurrencyWrite[]): Promise<void> => {
  await tx`
    insert into store_currency (store_id, currency, mode, rounding, status, position)
    select ${storeId}, x.currency, x.mode, x.rounding, 'active', x.position
    from jsonb_to_recordset(${tx.json(currencies.map((c, position) => ({ ...c, position })) as unknown as postgres.JSONValue)}) as x(currency text, mode text, rounding text, position int)
    on conflict (store_id, currency) do update set status = 'active', mode = excluded.mode, rounding = excluded.rounding, position = excluded.position
  `
  await tx`update store_currency set status = 'removed' where store_id = ${storeId} and status = 'active' and not (currency = any(${pgArray(currencies.map((c) => c.currency))}::text[]))`
}

/** Markets selling in a currency or language no longer offered move to the main ones, as SetStore's save does. */
export const moveMarketsOffRemoved = async (tx: ScopedSql, storeId: string, main: { currency: string; language: string }, now: Date): Promise<number> =>
  (
    await tx`
      update market m set
        currency = case when m.currency = ${main.currency} or exists (select 1 from store_currency c where c.store_id = m.store_id and c.currency = m.currency and c.status = 'active') then m.currency else ${main.currency} end,
        language = case when m.language = ${main.language} or exists (select 1 from store_language l where l.store_id = m.store_id and l.language = m.language and l.status = 'active') then m.language else ${main.language} end,
        -- The duty-free threshold is money in the market's currency (CATALOG T): a new currency needs its own.
        duties_threshold_amount = case when m.currency = ${main.currency} or exists (select 1 from store_currency c where c.store_id = m.store_id and c.currency = m.currency and c.status = 'active') then m.duties_threshold_amount else null end,
        updated_at = ${now}, revision = m.revision + 1
      where m.store_id = ${storeId} and m.deleted_at is null
        and (
          not (m.currency = ${main.currency} or exists (select 1 from store_currency c where c.store_id = m.store_id and c.currency = m.currency and c.status = 'active'))
          or not (m.language = ${main.language} or exists (select 1 from store_language l where l.store_id = m.store_id and l.language = m.language and l.status = 'active'))
        )
    `
  ).count

export interface MarketRow {
  id: string
  parent_id: string | null
  name: string
  is_primary: boolean
  is_fallback: boolean
  countries: string[]
  currency: string
  language: string
  price_adjustment_bps: number
  web_mode: 'main' | 'path'
  path_prefix: string | null
  products: 'all' | 'some'
  excluded_product_ids: string[]
  duties_mode: 'none' | 'by_code' | 'flat'
  duties_rate_bps: number | null
  duties_threshold_amount: string | null
  status: 'active' | 'inactive'
  revision: number
  created_at: Date
}

const marketColumns = (tx: ScopedSql) => tx`
  m.id, m.parent_id, m.name, m.is_primary, m.is_fallback, m.countries, m.currency::text as currency, m.language, m.price_adjustment_bps,
  m.web_mode, m.path_prefix, m.products,
  coalesce((select json_agg(e.product_id order by e.product_id) from market_excluded_product e where e.market_id = m.id), '[]'::json) as excluded_product_ids,
  m.duties_mode, m.duties_rate_bps, m.duties_threshold_amount::text as duties_threshold_amount, m.status, m.revision, m.created_at
`

/** By creation, oldest first: the primary market, made with the store, leads; sub-markets in the same list, each naming its parent. */
export const selectMarkets = (tx: ScopedSql, storeId: string, window: PageWindow): Promise<MarketRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<MarketRow[]>`
    select ${marketColumns(tx)} from market m
    where m.store_id = ${storeId} and m.deleted_at is null
      and ${window.after ? tx`(m.created_at, m.id) > (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(m.created_at, m.id) < (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by m.created_at ${backwards ? tx`desc` : tx`asc`}, m.id ${backwards ? tx`desc` : tx`asc`}
    limit ${window.limit + 1}
  `
}

export const selectMarket = async (tx: ScopedSql, storeId: string, id: string, lock = false): Promise<MarketRow | null> =>
  (await tx<MarketRow[]>`select ${marketColumns(tx)} from market m where m.id = ${id} and m.store_id = ${storeId} and m.deleted_at is null ${lock ? tx`for update` : tx``}`)[0] ?? null

export interface MarketWrite {
  parentId: string | null
  name: string
  countries: string[]
  currency: string
  language: string
  priceAdjustmentBps: number
  webMode: 'main' | 'path'
  pathPrefix: string | null
  products: 'all' | 'some'
  dutiesMode: 'none' | 'by_code' | 'flat'
  dutiesRateBps: number | null
  dutiesThresholdAmount: string | null
  active: boolean
}

export const insertMarket = async (tx: ScopedSql, storeId: string, m: MarketWrite, now: Date): Promise<{ id: string }> => {
  const [row] = await tx<{ id: string }[]>`
    insert into market (store_id, parent_id, name, countries, currency, language, price_adjustment_bps, web_mode, path_prefix, products,
      duties_mode, duties_rate_bps, duties_threshold_amount, status, created_at, updated_at)
    values (${storeId}, ${m.parentId}, ${m.name}, ${tx.json(m.countries)}, ${m.currency}, ${m.language}, ${m.priceAdjustmentBps}, ${m.webMode}, ${m.pathPrefix}, ${m.products},
      ${m.dutiesMode}, ${m.dutiesRateBps}, ${m.dutiesThresholdAmount}, ${m.active ? 'active' : 'inactive'}, ${now}, ${now})
    returning id
  `
  if (!row) throw new Error('market: insert returned no row')
  return row
}

/** At the revision read; false when someone saved it since. */
export const updateMarket = async (tx: ScopedSql, storeId: string, id: string, revision: number, m: MarketWrite, now: Date): Promise<boolean> =>
  (
    await tx`
      update market set parent_id = ${m.parentId}, name = ${m.name}, countries = ${tx.json(m.countries)}, currency = ${m.currency}, language = ${m.language},
        price_adjustment_bps = ${m.priceAdjustmentBps}, web_mode = ${m.webMode}, path_prefix = ${m.pathPrefix}, products = ${m.products},
        duties_mode = ${m.dutiesMode}, duties_rate_bps = ${m.dutiesRateBps}, duties_threshold_amount = ${m.dutiesThresholdAmount},
        status = ${m.active ? 'active' : 'inactive'}, updated_at = ${now}, revision = revision + 1
      where id = ${id} and store_id = ${storeId} and revision = ${revision} and deleted_at is null
    `
  ).count > 0

/** The products this market doesn't sell, replacing what it had; each one the store's. */
export const setExcludedProducts = async (tx: ScopedSql, storeId: string, marketId: string, productIds: readonly string[]): Promise<void> => {
  await tx`delete from market_excluded_product where market_id = ${marketId} and store_id = ${storeId}`
  if (productIds.length === 0) return
  await tx`
    insert into market_excluded_product (market_id, product_id, store_id)
    select ${marketId}, p.id, ${storeId} from product p where p.store_id = ${storeId} and p.id = any(${pgArray(productIds)}::uuid[]) and p.deleted_at is null
  `
}

/** Which of these products each market selling only some leaves out, as market id → product ids. */
export const selectExclusions = async (tx: ScopedSql, storeId: string, productIds: readonly string[]): Promise<Map<string, Set<string>>> => {
  const rows = await tx<{ market_id: string; product_id: string }[]>`
    select x.market_id, x.product_id from market_excluded_product x join market m on m.id = x.market_id
    where x.store_id = ${storeId} and m.products = 'some' and x.product_id = any(${pgArray(productIds)}::uuid[])
  `
  const out = new Map<string, Set<string>>()
  for (const r of rows) out.set(r.market_id, (out.get(r.market_id) ?? new Set()).add(r.product_id))
  return out
}

/** Products of the store among these, for a market's exclusions. */
export const countStoreProducts = async (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from product where store_id = ${storeId} and id = any(${pgArray(ids)}::uuid[]) and deleted_at is null`)[0]?.n ?? 0

/** Its sub-markets become top-level ones, as SetMarkets' delete does; orders keep what they were placed under. */
export const deleteMarket = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<void> => {
  // The parent goes first, so its lifted sub-markets don't overlap its countries.
  await tx`update market set deleted_at = ${now}, is_fallback = false where id = ${id} and store_id = ${storeId}`
  await tx`update market set parent_id = null, updated_at = ${now}, revision = revision + 1 where parent_id = ${id} and store_id = ${storeId} and deleted_at is null`
}

/** "Everywhere else": one top-level market or none. Answers the market that had it, if another. */
export const setFallbackMarket = async (tx: ScopedSql, storeId: string, id: string | null): Promise<{ id: string; name: string } | null> => {
  const [was] = await tx<{ id: string; name: string }[]>`update market set is_fallback = false where store_id = ${storeId} and is_fallback and id is distinct from ${id}::uuid returning id, name`
  if (id) await tx`update market set is_fallback = true where id = ${id} and store_id = ${storeId} and parent_id is null and deleted_at is null`
  return was ?? null
}

/** What a market write clashed with, from 0051's checks; null for anything else. */
export const marketClash = (error: unknown): 'COUNTRY_TAKEN' | 'NOT_PARENTS_COUNTRIES' | 'BAD_PARENT' | 'DUPLICATE_NAME' | 'DUPLICATE_PATH' | null => {
  if (typeof error !== 'object' || error === null) return null
  const message = 'message' in error ? String(error.message) : ''
  const constraint = 'constraint_name' in error ? String(error.constraint_name) : ''
  if (message.includes('a country is in one market only')) return 'COUNTRY_TAKEN'
  if (message.includes('countries are its parent')) return 'NOT_PARENTS_COUNTRIES'
  if (message.includes('a sub-market sits under') || constraint === 'market_fallback_top') return 'BAD_PARENT'
  if (constraint === 'market_name_key') return 'DUPLICATE_NAME'
  if (constraint === 'market_path_key') return 'DUPLICATE_PATH'
  return null
}

export interface ReadinessRow {
  id: string
  product_type: string
  /** Each live version's prices, as priceInMarket reads them. */
  versions: { prices: { currency: string; amount: string; compare_at_amount: string | null }[] }[]
  /** Compliance fields with a value, as region:field. */
  compliance: string[]
}

/** What readiness needs of a page of products, in one query (no N+1). */
export const selectReadinessFacts = (tx: ScopedSql, storeId: string, productIds: readonly string[]): Promise<ReadinessRow[]> =>
  tx<ReadinessRow[]>`
    select p.id, p.product_type,
      coalesce((select json_agg(json_build_object('prices', coalesce((select json_agg(json_build_object('currency', vp.currency::text, 'amount', vp.amount::text, 'compare_at_amount', vp.compare_at_amount::text))
          from version_price vp where vp.version_id = v.id), '[]'::json)))
        from product_version v where v.product_id = p.id and v.deleted_at is null), '[]'::json) as versions,
      coalesce((select json_agg(c.region || ':' || c.field) from product_compliance c where c.product_id = p.id and c.value <> ''), '[]'::json) as compliance
    from product p where p.store_id = ${storeId} and p.deleted_at is null and p.id = any(${pgArray(productIds)}::uuid[])
  `

/** The markets a product sells in: the live top-level ones; sub-markets share their parent's countries. */
export const selectSellingMarkets = (tx: ScopedSql, storeId: string): Promise<{ id: string; name: string; countries: string[]; currency: string; price_adjustment_bps: number }[]> =>
  tx<{ id: string; name: string; countries: string[]; currency: string; price_adjustment_bps: number }[]>`
    select id, name, countries, currency::text as currency, price_adjustment_bps from market
    where store_id = ${storeId} and deleted_at is null and parent_id is null and status = 'active'
    order by created_at, id
  `
