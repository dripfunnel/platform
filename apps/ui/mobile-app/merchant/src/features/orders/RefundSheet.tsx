import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { refund, refundReasons, type Order, type OrderReturn, type RefundReason } from '../../api/order'
import type { ApiClient } from '../../graphql'
import { formatList, minorOf } from '../../format'
import { locale, t } from '../../messages'
import { useTheme } from '../../theme'
import { Switch } from '../common/Switch'
import { TextField } from '../common/TextField'
import { FormSheet } from '../settings/FormSheet'
import { PickerField } from '../settings/PickerField'
import { freeToReturn, leftInReturn, paidByHand } from './orderDetail'
import { methodText, moneyText } from './orderView'
import { PickLines } from './PickLines'
import { pickedCount, pickedLines, type PickRow } from './picks'

type Props = {
  order: Order
  /** The received return being refunded, or null for a refund on its own. */
  from: OrderReturn | null
  client: ApiClient
  onClose: () => void
  onDone: () => Promise<void>
}

// "Refund" (PortalOrders): the picked units grouped by who refunds them, each at what the shopper paid for it as the API works it out, or an amount
// on its own for goodwill (`extra`, in minor units). The store picking a supplier's lines overrides it, and the sheet says so before it does.
export function RefundSheet({ order, from, client, onClose, onDone }: Props) {
  const { colors } = useTheme()
  const groups = order.parts
    .map((part) => ({ part, rows: part.lines.map((line): PickRow => ({ line, part, max: from ? leftInReturn(order, from, line.id) : freeToReturn(order, line) })).filter((row) => row.max > 0) }))
    .filter((group) => group.rows.length > 0)
  const [picks, setPicks] = useState<Record<string, number>>(() => (from ? Object.fromEntries(groups.flatMap((group) => group.rows.map((row) => [row.line.id, row.max]))) : {}))
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState<RefundReason>(from ? 'returned' : 'goodwill')
  const [restock, setRestock] = useState(from !== null)

  const units = pickedCount(picks) > 0
  const currency = order.total?.currency ?? null
  const typed = units || currency === null ? null : minorOf(amount, currency)
  const goodwill = typed !== null && typed !== 'invalid' && typed !== '0' ? typed : null
  const overridden = [...new Set(groups.filter((group) => group.part.supplierId !== null && group.rows.some((row) => (picks[row.line.id] ?? 0) > 0)).map((group) => group.part.supplierName ?? ''))]
  const method = methodText(order.paymentMethod)
  const name = order.customerName ?? t('orders.detail.customer.guest')

  const check = () => {
    if (typed === 'invalid') return t('orders.detail.refund.amountInvalid')
    return !units && goodwill === null ? t('orders.detail.refund.pickNone') : null
  }

  return (
    <FormSheet
      title={t('orders.detail.refund.title')}
      body={t(paidByHand(order.paymentMethod) ? 'orders.detail.refund.noteByHand' : 'orders.detail.refund.note', { method })}
      confirm={goodwill !== null && currency !== null ? t('orders.detail.refund.confirmAmount', { amount: moneyText({ amount: goodwill, currency }) }) : t('orders.detail.refund.confirmPicked')}
      context="orders"
      onClose={onClose}
      check={check}
      onSubmit={async () => {
        await refund(client, { orderId: order.id, returnId: from?.id ?? null, lines: pickedLines(picks), extra: goodwill, reason, restock: restock && units, override: overridden.length > 0 })
        await onDone()
        return overridden.length > 0 ? t('orders.detail.refund.doneOverride', { name, suppliers: formatList(overridden, locale) }) : t('orders.detail.refund.done', { name })
      }}
    >
      {groups.map(({ part, rows }) => {
        const theirs = part.supplierId !== null
        const supplier = part.supplierName ?? ''
        return (
          <View key={part.id} style={[styles.group, { borderColor: colors.border }]}>
            <Text style={[styles.groupTitle, { color: colors.text }]}>{theirs ? t('orders.detail.refund.theirs', { supplier }) : t('orders.detail.refund.mine')}</Text>
            <Text style={[styles.who, { color: theirs ? colors.warning : colors.success }]}>{theirs ? t('orders.detail.refund.theyRefund', { supplier }) : t('orders.detail.refund.youRefund')}</Text>
            <PickLines
              rows={rows}
              picks={picks}
              onPick={(lineId, quantity) => {
                setPicks((current) => ({ ...current, [lineId]: quantity }))
                setAmount('')
              }}
              sub={(row) => t('orders.detail.refund.each', { price: moneyText(row.line.unitPrice) })}
            />
            {theirs && overridden.includes(supplier) ? <Text style={[styles.override, { color: colors.warning }]}>{t('orders.detail.refund.override', { supplier })}</Text> : null}
          </View>
        )
      })}
      {currency !== null ? (
        <TextField
          label={t('orders.detail.refund.amount')}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          editable={!units}
          placeholder={units ? t('orders.detail.refund.amountPicked') : ''}
          invalid={typed === 'invalid'}
        />
      ) : null}
      <PickerField label={t('orders.detail.refund.reason')} value={reason} options={refundReasons.map((value) => ({ value, label: t(`orders.detail.refund.reasons.${value}`) }))} onChange={(value) => setReason(refundReasons.find((known) => known === value) ?? 'other')} />
      <Switch label={t('orders.detail.refund.restock')} value={restock && units} onChange={setRestock} disabled={!units} />
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  group: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  groupTitle: { fontSize: 14, fontWeight: '800' },
  who: { fontSize: 12, fontWeight: '700' },
  override: { fontSize: 13, lineHeight: 19 },
})
