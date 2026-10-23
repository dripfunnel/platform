import { StyleSheet, Text, View } from 'react-native'
import type { Sale } from '../../api/supplier'
import { formatDay, formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { StatusChip } from '../products/StatusChip'
import { lineName } from '../orders/orderDetail'
import { moneyText } from '../orders/orderView'
import { saleStatus, saleTone } from './supplierView'

// A sold line as a stacked card (VendorViews "sales" at phone width): the order and its day (UTC, as a supplier reads no store settings), the product, how many, the
// line at the price sold, and whether it stands, was refunded in part or in full, or the order was cancelled. Every figure is the API's.
export function SaleCard({ sale }: { sale: Sale }) {
  const { colors, radii } = useTheme()
  const status = saleStatus(sale)
  const label = status === 'partlyRefunded' ? t('supplier.sales.status.partlyRefunded', { count: formatNumber(sale.refundedQuantity, locale), quantity: formatNumber(sale.quantity, locale) }) : t(`supplier.sales.status.${status}`)
  return (
    <View accessible style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <View style={styles.text}>
        <Text style={[styles.number, { color: colors.text }]}>{sale.orderNumber}</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{formatDay(sale.placedAt, locale)}</Text>
        <Text style={[styles.product, { color: colors.textStrong }]}>{lineName(sale)}</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('orders.detail.line.quantity', { count: formatNumber(sale.quantity, locale) })}</Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, { color: colors.text }]}>{moneyText(sale.amount)}</Text>
        <StatusChip label={label} tone={saleTone[status]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderWidth: 1, minHeight: 88 },
  text: { flex: 1, gap: 2 },
  number: { fontSize: 15, fontWeight: '800', fontFamily: 'monospace' },
  product: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 12 },
  right: { alignItems: 'flex-end', gap: 4, maxWidth: '45%' },
  amount: { fontSize: 15, fontWeight: '700' },
})
