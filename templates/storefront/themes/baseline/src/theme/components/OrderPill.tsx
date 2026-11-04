import { clsx } from 'clsx'
import { useStorefront, type Order } from '@dripfunnel/storefront-core/theme'

/** Where an order stands, as the order page and the account's list both show it. */
export const OrderPill = ({ order, className }: { order: Pick<Order, 'cancelled' | 'payment' | 'method'>; className?: string }) => {
  const { t } = useStorefront()
  const pill = order.cancelled
    ? { words: t('shop.order.pills.cancelled'), tone: 'danger' }
    : order.payment === 'paid'
      ? { words: t('shop.order.pills.paid'), tone: 'paid' }
      : order.payment === 'refunded'
        ? { words: t('shop.order.pills.refunded'), tone: 'quiet' }
        : order.payment === 'confirming'
          ? { words: t('shop.order.pills.confirming'), tone: 'danger' }
          : order.method === 'cod'
            ? { words: t('shop.order.pills.cod'), tone: 'quiet' }
            : { words: t('shop.order.pills.transfer'), tone: 'danger' }
  return <span className={clsx('py-1 px-3 self-start rounded-button text-[13px] font-semibold', pill.tone === 'danger' && 'bg-soft text-danger', pill.tone === 'paid' && 'bg-tint text-accent', pill.tone === 'quiet' && 'bg-soft text-ink-soft', className)}>{pill.words}</span>
}
