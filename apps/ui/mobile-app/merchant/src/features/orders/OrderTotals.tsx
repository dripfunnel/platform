import { StyleSheet, Text, View } from 'react-native'
import type { Order } from '../../api/order'
import type { ApiMoney } from '../../api/orders'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { SectionCard } from '../common/SectionCard'
import { methodText, moneyText } from './orderView'

type Row = { key: string; label: string; value: string; strong?: boolean; refund?: boolean }

const some = (money: ApiMoney | null): money is ApiMoney => money !== null && /[1-9]/.test(money.amount)

// The order's money exactly as the API worked it out: items, discount, delivery, tax, duties, total and what went back. Nothing is added up here.
export function OrderTotals({ order }: { order: Order }) {
  const { colors } = useTheme()
  const rows: Row[] = []
  if (order.subtotal) rows.push({ key: 'items', label: t('orders.detail.totals.items'), value: moneyText(order.subtotal) })
  if (some(order.discount)) rows.push({ key: 'discount', label: t('orders.detail.totals.discount'), value: t('orders.detail.totals.less', { amount: moneyText(order.discount) }) })
  if (order.shipping) rows.push({ key: 'delivery', label: t('orders.detail.totals.delivery'), value: some(order.shipping) ? moneyText(order.shipping) : t('orders.detail.totals.free') })
  if (order.tax) rows.push({ key: 'tax', label: order.taxInclusive ? t('orders.detail.totals.includesTax') : t('orders.detail.totals.tax'), value: moneyText(order.tax) })
  if (some(order.duties)) rows.push({ key: 'duties', label: t('orders.detail.totals.duties'), value: moneyText(order.duties) })
  if (order.total) rows.push({ key: 'total', label: t('orders.detail.totals.total'), value: moneyText(order.total), strong: true })
  if (some(order.refunded)) rows.push({ key: 'refunded', label: t('orders.detail.totals.refunded'), value: t('orders.detail.totals.less', { amount: moneyText(order.refunded) }), refund: true })
  rows.push({ key: 'method', label: t('orders.detail.totals.paidWith'), value: methodText(order.paymentMethod) })
  return (
    <SectionCard title={t('orders.detail.totals.title')}>
      {rows.map((row) => (
        <View key={row.key} style={styles.row}>
          <Text style={[styles.label, { color: row.refund ? colors.danger : colors.text }, row.strong ? styles.strong : null]}>{row.label}</Text>
          <Text style={[styles.value, { color: row.refund ? colors.danger : colors.text }, row.strong ? styles.strong : null]}>{row.value}</Text>
        </View>
      ))}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, minHeight: 28, alignItems: 'center' },
  label: { fontSize: 14, flexShrink: 1 },
  value: { fontSize: 14, fontVariant: ['tabular-nums'] },
  strong: { fontWeight: '800', fontSize: 15 },
})
