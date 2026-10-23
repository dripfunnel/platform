import { StyleSheet, Text, View } from 'react-native'
import type { SupplierLine, SupplierOrder, SupplierPart } from '../../api/supplier'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { SectionCard } from '../common/SectionCard'
import { lineName } from '../orders/orderDetail'

const groupState = (order: SupplierOrder, part: SupplierPart): string => {
  if (order.state === 'cancelled' || part.state === 'cancelled') return t('orders.detail.groups.cancelled')
  const left = part.lines.reduce((total, line) => total + line.quantity - (part.shippingMode === 'to-store' ? line.sentToStoreQuantity : line.fulfilledQuantity), 0)
  return left > 0 ? t('orders.detail.groups.toShip', { count: formatNumber(left, locale) }) : t('orders.detail.groups.allShipped')
}

const lineState = (line: SupplierLine, part: SupplierPart): string => {
  if (part.shippingMode === 'to-store' && line.sentToStoreQuantity > 0) return t('orders.detail.line.sent', { sent: formatNumber(line.sentToStoreQuantity, locale), count: formatNumber(line.quantity, locale) })
  if (line.fulfilledQuantity > 0) return t('orders.detail.line.shipped', { shipped: formatNumber(line.fulfilledQuantity, locale), count: formatNumber(line.quantity, locale) })
  return t('orders.detail.line.notShipped')
}

// The supplier's own lines, how many have gone and where each stands. No amounts: an order's money spans sellers, so a supplier reads none of it here.
export function SupplierLines({ order }: { order: SupplierOrder }) {
  const { colors } = useTheme()
  return (
    <>
      {order.parts.map((part) => (
        <SectionCard key={part.id} title={t('supplier.order.items')} sub={groupState(order, part)}>
          {part.lines.map((line) => (
            <View key={line.id} style={styles.line}>
              <View style={styles.name}>
                <Text style={[styles.label, { color: colors.text }]}>{lineName(line)}</Text>
                <Text style={[styles.sub, { color: colors.muted }]}>{lineState(line, part)}</Text>
              </View>
              <Text style={[styles.qty, { color: colors.textStrong }]}>{t('orders.detail.line.quantity', { count: formatNumber(line.quantity, locale) })}</Text>
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
  qty: { fontSize: 14, fontWeight: '700' },
})
