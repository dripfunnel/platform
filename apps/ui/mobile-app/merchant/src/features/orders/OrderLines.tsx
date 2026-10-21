import { StyleSheet, Text, View } from 'react-native'
import type { Order, OrderLine, OrderPart } from '../../api/order'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { useTheme } from '../../theme'
import { SectionCard } from '../common/SectionCard'
import { lineName } from './orderDetail'
import { moneyText } from './orderView'

const groupTitle = (part: OrderPart): string => (part.supplierId === null ? t('orders.detail.groups.mine') : t('orders.detail.groups.supplier', { supplier: part.supplierName ?? '' }))

const groupState = (order: Order, part: OrderPart): string => {
  if (order.state === 'cancelled' || part.state === 'cancelled') return t('orders.detail.groups.cancelled')
  const left = part.lines.reduce((total, line) => total + line.quantity - line.fulfilledQuantity, 0)
  return left > 0 ? t('orders.detail.groups.toShip', { count: formatNumber(left, locale) }) : t('orders.detail.groups.allShipped')
}

const lineState = (line: OrderLine, part: OrderPart): string => {
  if (line.fulfilledQuantity > 0) return t('orders.detail.line.shipped', { shipped: formatNumber(line.fulfilledQuantity, locale), count: formatNumber(line.quantity, locale) })
  if (part.shippingMode === 'to-store' && line.sentToStoreQuantity > 0) return t('orders.detail.line.sent', { sent: formatNumber(line.sentToStoreQuantity, locale), count: formatNumber(line.quantity, locale) })
  return t('orders.detail.line.notShipped')
}

// The lines by who packs them ("You pack these", "{Supplier} packs these"), with how many have gone and each line's total as the API worked it out.
export function OrderLines({ order }: { order: Order }) {
  const { colors } = useTheme()
  return (
    <>
      {order.parts.map((part) => (
        <SectionCard key={part.id} title={groupTitle(part)} sub={groupState(order, part)}>
          {part.lines.map((line) => (
            <View key={line.id} style={styles.line}>
              <View style={styles.name}>
                <Text style={[styles.label, { color: colors.text }]}>{lineName(line)}</Text>
                <Text style={[styles.sub, { color: colors.muted }]}>{lineState(line, part)}</Text>
              </View>
              <Text style={[styles.qty, { color: colors.textStrong }]}>{t('orders.detail.line.quantity', { count: formatNumber(line.quantity, locale) })}</Text>
              <Text style={[styles.total, { color: colors.text }]}>{moneyText(line.total ?? line.amount)}</Text>
            </View>
          ))}
        </SectionCard>
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  name: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  sub: { fontSize: 12 },
  qty: { fontSize: 13 },
  total: { fontSize: 14, fontWeight: '700', minWidth: 72, textAlign: 'right' },
})
