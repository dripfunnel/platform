import { useState } from 'react'
import { cancelOrder, cancelReasons, type CancelReason, type Order } from '../../api/order'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { ChoiceRows } from '../settings/ChoiceRows'
import { FormSheet } from '../settings/FormSheet'
import { methodText } from './orderView'

type Props = { order: Order; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

// Cancelling an order nothing has left: says first what the shopper gets back and what happens to the items, then asks why.
export function CancelOrderSheet({ order, client, onClose, onDone }: Props) {
  const [reason, setReason] = useState<CancelReason>('out_of_stock')
  const paid = order.paymentState === 'paid' || order.paymentState === 'partly_refunded'
  const name = order.customerName ?? t('orders.detail.customer.guest')
  return (
    <FormSheet
      title={t('orders.cancel.title', { number: order.number })}
      body={paid ? t('orders.cancel.bodyPaid', { name, method: methodText(order.paymentMethod) }) : t('orders.cancel.bodyUnpaid')}
      confirm={t('orders.cancel.confirm')}
      cancel={t('orders.cancel.keep')}
      danger
      context="orders"
      onClose={onClose}
      onSubmit={async () => {
        await cancelOrder(client, order.id, reason)
        await onDone()
        return t('orders.cancel.done', { number: order.number })
      }}
    >
      <ChoiceRows label={t('orders.cancel.reason')} value={reason} options={cancelReasons.map((value) => ({ value, label: t(`orders.cancel.reasons.${value}`) }))} onChange={setReason} />
    </FormSheet>
  )
}
