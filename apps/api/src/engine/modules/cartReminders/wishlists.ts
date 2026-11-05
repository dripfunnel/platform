import type postgres from 'postgres'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { selectWishlistReminders, type WishlistReminderRow } from '#db/scoped/wishlistReminders'
import { countWishlistShoppers, countWishlistTabs, selectWishlistShopper, selectWishlistShoppers, selectWishlistSummary, type WishlistShopperRow, type WishlistSummaryRow, type WishlistTab } from '#db/scoped/wishlist'
import { wishlistItemsNow, type WishlistItemNow } from './wishlist'

// The Carts screen's Wishlists tab (#1215): every merchant role reads which shoppers saved what, in the store's own scope;
// a supplier meets nothing, since a wishlist is the merchant's customer data (ACCESS §5.1 `carts.read`).

export interface WishlistShopperDetail extends WishlistShopperRow {
  /** Every product the shopper saved that they could see now, newest first; sold-out ones say so. */
  products: WishlistItemNow[]
  /** Their reminders, newest first. */
  reminders: WishlistReminderRow[]
}

export interface WishlistsDeps {
  sql: postgres.Sql
  context: TenantContext
  now: () => Date
}

export const createWishlistsService = ({ sql, context, now }: WishlistsDeps) => {
  const { storeId } = context
  const supplier = context.sellerScope.kind === 'seller'

  const list = async (tab: WishlistTab | null, search: string | null, window: PageWindow): Promise<WishlistShopperRow[]> => {
    if (supplier) return []
    return withScope(sql, context, (tx) => selectWishlistShoppers(tx, storeId, tab, search?.trim().slice(0, 100) || null, window))
  }

  const counts = async (): Promise<Record<WishlistTab, number>> => (supplier ? { waiting: 0, reminded: 0, stopped: 0 } : withScope(sql, context, (tx) => countWishlistTabs(tx, storeId)))

  /** The last `days` days of reminders beside who has a wishlist now; 14 unless asked, at most 90. */
  const summary = async (days: number | null): Promise<(WishlistSummaryRow & { days: number }) | null> => {
    if (supplier) return null
    const span = Math.min(Math.max(days ?? 14, 1), 90)
    const row = await withScope(sql, context, (tx) => selectWishlistSummary(tx, storeId, new Date(now().getTime() - span * 86_400_000)))
    return { ...row, days: span }
  }

  const count = async (): Promise<number> => (supplier ? 0 : withScope(sql, context, (tx) => countWishlistShoppers(tx, storeId)))

  const detail = async (customerId: string): Promise<WishlistShopperDetail | null> => {
    if (supplier || !isUuid(customerId)) return null
    const found = await withScope(sql, context, async (tx) => {
      const shopper = await selectWishlistShopper(tx, storeId, customerId.toLowerCase())
      return shopper ? { shopper, reminders: await selectWishlistReminders(tx, storeId, customerId.toLowerCase()) } : null
    })
    if (!found) return null
    const { shopper: row } = found
    const products = await wishlistItemsNow({ sql, now }, { storeId, partnerId: context.partnerId, language: row.language, currency: row.currency, marketId: null, features: {} }, row.product_ids, null, false)
    return { ...row, products, reminders: found.reminders }
  }

  return { list, count, counts, summary, detail }
}
