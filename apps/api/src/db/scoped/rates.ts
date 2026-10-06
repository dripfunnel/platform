import type postgres from 'postgres'
import { pgArray, type ScopedSql } from './index'

// The euro reference rates (migration 0052): read by every store's catalogue, written by the rates job only.

export interface RateRow {
  currency: string
  per_euro: string
  published_on: string
  fetched_at: Date
}

/** The rates for these currencies, the euro being 1 always. */
export const selectRates = async (tx: ScopedSql, currencies: readonly string[]): Promise<Map<string, RateRow>> => {
  const rows = await tx<RateRow[]>`
    select currency::text as currency, per_euro::text as per_euro, published_on::text as published_on, fetched_at
    from exchange_rate where currency = any(${pgArray(currencies)}::text[])
  `
  return new Map(rows.map((r) => [r.currency, r]))
}

/** Every rate held: the currencies a store can convert to (SetStore's "Add currency"). */
export const selectAllRates = (tx: ScopedSql): Promise<RateRow[]> =>
  tx<RateRow[]>`select currency::text as currency, per_euro::text as per_euro, published_on::text as published_on, fetched_at from exchange_rate order by currency`

/** Each published rate, replacing the one held; a day older than the one held is ignored. */
export const upsertRates = async (tx: ScopedSql, rates: { publishedOn: string; perEuro: Record<string, string> }, now: Date): Promise<number> =>
  (
    await tx`
      insert into exchange_rate (currency, per_euro, source, published_on, fetched_at)
      select x.currency, x.rate::numeric, 'ecb', ${rates.publishedOn}::date, ${now}
      from jsonb_each_text(${tx.json(rates.perEuro as unknown as postgres.JSONValue)}) as x(currency, rate)
      where x.currency ~ '^[A-Z]{3}$' and x.currency <> 'EUR'
      on conflict (currency) do update set per_euro = excluded.per_euro, published_on = excluded.published_on, fetched_at = excluded.fetched_at
      where exchange_rate.published_on <= excluded.published_on
    `
  ).count
