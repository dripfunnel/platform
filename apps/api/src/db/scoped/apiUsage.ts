import type { ScopedSql } from './index'

// Calls by a store's keys and apps this minute and this month (migrations/0150), counted in system scope as each
// is resolved, one row a store, so the counter never grows with traffic.

export interface ApiCalls {
  minute: number
  month: number
}

/** Counts this call and answers the totals with it; a new minute or month starts its count again. */
export const countApiCall = async (tx: ScopedSql, storeId: string, now: Date): Promise<ApiCalls> => {
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000)
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const [row] = await tx<{ minute_used: number; month_used: number }[]>`
    insert into api_usage as u (store_id, minute_start, minute_used, month_start, month_used)
    values (${storeId}, ${minute}, 1, ${month}::date, 1)
    on conflict (store_id) do update set
      minute_used = case when u.minute_start = excluded.minute_start then u.minute_used + 1 else 1 end,
      minute_start = excluded.minute_start,
      month_used = case when u.month_start = excluded.month_start then u.month_used + 1 else 1 end,
      month_start = excluded.month_start
    returning minute_used, month_used
  `
  return { minute: row?.minute_used ?? 1, month: row?.month_used ?? 1 }
}
