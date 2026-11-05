import type { ScopedSql } from './index'
import { goneThrough } from './storeOrders'

// Best sellers (migration 0383; DATA-MODEL §7.3): every store's ranking rewritten by the hourly cron in system scope.

/** How far back a sale counts. */
export const rankDays = 90

/** Each store's products by units on orders that went through in the last 90 days; a product no longer selling drops out. */
export const rankBestSellers = async (tx: ScopedSql, now: Date): Promise<number> => {
  const since = new Date(now.getTime() - rankDays * 24 * 60 * 60 * 1000)
  const ranked = await tx`
    with sold as (
      select l.store_id, l.product_id, sum(l.quantity)::bigint as units
      from "order" o join order_line l on l.order_id = o.id and l.store_id = o.store_id
      where o.state = 'placed' and o.placed_at >= ${since} and o.placed_at <= ${now} and ${goneThrough(tx)}
        and exists (select 1 from product p where p.id = l.product_id and p.store_id = l.store_id)
      group by l.store_id, l.product_id
    )
    insert into product_rank (store_id, product_id, units, position, ranked_at)
    select store_id, product_id, units, row_number() over (partition by store_id order by units desc, product_id), ${now} from sold
    on conflict (store_id, product_id) do update set units = excluded.units, position = excluded.position, ranked_at = excluded.ranked_at
  `
  await tx`delete from product_rank where ranked_at <> ${now}`
  return ranked.count
}
