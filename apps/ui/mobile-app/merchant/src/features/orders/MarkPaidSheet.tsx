import { markOrderPaid, type Order } from '../../api/order'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { FormSheet } from '../settings/FormSheet'
import { methodText, moneyText } from './orderView'

type Props = { order: Order; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

// Cash on delivery and a transfer reach the store by hand, so the person says when the money has come. The API decides who may.
export function MarkPaidSheet({ order, client, onClose, onDone }: Props) {
  const method = methodText(order.paymentMethod)
  return (
    <FormSheet
      title={t('orders.detail.markPaid.title', { number: order.number })}
      body={order.total ? t('orders.detail.markPaid.body', { amount: moneyText(order.total), method }) : t('orders.detail.markPaid.bodyNoAmount', { method })}
      confirm={t('orders.detail.markPaid.confirm')}
      cancel={t('orders.detail.markPaid.cancel')}
      context="orders"
      onClose={onClose}
      onSubmit={async () => {
        await markOrderPaid(client, order.id)
        await onDone()
        return t('orders.detail.markPaid.done', { number: order.number })
      }}
    />
  )
}
