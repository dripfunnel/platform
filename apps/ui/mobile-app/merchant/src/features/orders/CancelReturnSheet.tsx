import { cancelReturn, type OrderReturn } from '../../api/order'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { FormSheet } from '../settings/FormSheet'

type Props = { ret: OrderReturn; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

export function CancelReturnSheet({ ret, client, onClose, onDone }: Props) {
  return (
    <FormSheet
      title={t('orders.detail.returns.cancelTitle', { number: ret.number })}
      body={t('orders.detail.returns.cancelBody')}
      confirm={t('orders.detail.returns.cancelConfirm')}
      cancel={t('orders.detail.returns.cancelKeep')}
      danger
      context="orders"
      onClose={onClose}
      onSubmit={async () => {
        await cancelReturn(client, ret.id)
        await onDone()
        return t('orders.detail.returns.cancelled', { number: ret.number })
      }}
    />
  )
}
