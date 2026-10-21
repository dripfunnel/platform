import type { StatusIconName, StatusTone } from '@dripfunnel/shared/ui'
import type { Sale } from '../../api/sales'
import { locale } from '../../messages'

// How VendorViews words a sold line. `mySales` answers the order's state and the units refunded, not the part's
// shipping, so a line says sold, refunded or cancelled (FIRST-RELEASE §17).

export type SaleStatus = 'sold' | 'partlyRefunded' | 'refunded' | 'cancelled'

export const saleStatus = (sale: Pick<Sale, 'orderState' | 'quantity' | 'refundedQuantity'>): SaleStatus =>
  sale.orderState === 'cancelled' ? 'cancelled' : sale.refundedQuantity >= sale.quantity ? 'refunded' : sale.refundedQuantity > 0 ? 'partlyRefunded' : 'sold'

export const salePill: Record<SaleStatus, { tone: StatusTone; icon: StatusIconName }> = {
  sold: { tone: 'success', icon: 'ok' },
  partlyRefunded: { tone: 'info', icon: 'cross' },
  refunded: { tone: 'neutral', icon: 'cross' },
  cancelled: { tone: 'neutral', icon: 'ban' },
}

/** "4 Oct": a supplier reads no store settings, so its dates are UTC and the screen says so once. */
export const dayText = (iso: string): string => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso))
