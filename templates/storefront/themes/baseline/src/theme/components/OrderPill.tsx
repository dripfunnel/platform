import { clsx } from 'clsx'
import { useStorefront, type Order } from '@dripfunnel/storefront-core/theme'
import styles from '../styles/order.module.css'

/** Where an order stands, as the order page and the account's list both show it. */
export const OrderPill = ({ order, className }: { order: Pick<Order, 'cancelled' | 'payment' | 'method'>; className?: string }) => {
  const { t } = useStorefront()
  const pill = order.cancelled
    ? { words: t('shop.order.pills.cancelled'), tone: styles.pillBad }
    : order.payment === 'paid'
      ? { words: t('shop.order.pills.paid'), tone: styles.pillGood }
      : order.payment === 'refunded'
        ? { words: t('shop.order.pills.refunded'), tone: styles.pillInfo }
        : order.payment === 'confirming'
          ? { words: t('shop.order.pills.confirming'), tone: styles.pillWarn }
          : order.method === 'cod'
            ? { words: t('shop.order.pills.cod'), tone: styles.pillInfo }
            : { words: t('shop.order.pills.transfer'), tone: styles.pillWarn }
  return <span className={clsx(styles.pill, pill.tone, className)}>{pill.words}</span>
}
