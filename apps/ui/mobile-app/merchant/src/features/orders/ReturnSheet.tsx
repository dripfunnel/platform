import { useState } from 'react'
import { returnReasons, startReturn, type Order, type ReturnReason } from '../../api/order'
import type { ApiClient } from '../../graphql'
import { formatList } from '../../format'
import { locale, t } from '../../messages'
import { FormSheet } from '../settings/FormSheet'
import { PickerField } from '../settings/PickerField'
import { freeToReturn, suppliersOf } from './orderDetail'
import { PickLines } from './PickLines'
import { pickedCount, pickedLines, type PickRow } from './picks'

type Props = { order: Order; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

// "Start a return" (PortalOrders): the shipped units coming back, and why. Says where they go before it starts.
export function ReturnSheet({ order, client, onClose, onDone }: Props) {
  const [picks, setPicks] = useState<Record<string, number>>({})
  const [reason, setReason] = useState<ReturnReason>('doesnt_fit')
  const rows: PickRow[] = order.parts.flatMap((part) => part.lines.map((line) => ({ line, part, max: freeToReturn(order, line) })).filter((row) => row.max > 0))
  const suppliers = rows.some((row) => row.part.supplierId !== null)
  return (
    <FormSheet
      title={t('orders.detail.returns.start.title')}
      body={suppliers ? t('orders.detail.returns.start.noteSuppliers') : t('orders.detail.returns.start.note')}
      confirm={t('orders.detail.returns.start.confirm')}
      context="orders"
      onClose={onClose}
      check={() => (pickedCount(picks) === 0 ? t('orders.detail.returns.start.pickNone') : null)}
      onSubmit={async () => {
        const lines = pickedLines(picks)
        await startReturn(client, order.id, lines, reason)
        await onDone()
        const refunding = suppliersOf(order, lines.map((line) => line.lineId))
        return refunding.length > 0 ? t('orders.detail.returns.start.doneSuppliers', { suppliers: formatList(refunding, locale) }) : t('orders.detail.returns.start.done')
      }}
    >
      <PickLines
        rows={rows}
        picks={picks}
        onPick={(lineId, quantity) => setPicks((current) => ({ ...current, [lineId]: quantity }))}
        sub={(row) => (row.part.supplierName ? t('orders.detail.returns.start.supplierShipped', { supplier: row.part.supplierName, count: row.max }) : t('orders.detail.returns.start.shipped', { count: row.max }))}
      />
      <PickerField label={t('orders.detail.returns.start.reason')} value={reason} options={returnReasons.map((value) => ({ value, label: t(`orders.detail.returns.reasons.${value}`) }))} onChange={(value) => setReason(returnReasons.find((known) => known === value) ?? 'doesnt_fit')} />
    </FormSheet>
  )
}
