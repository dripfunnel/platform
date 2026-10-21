import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { SupplierOrderRow } from '../../api/supplier'
import { formatDateTime } from '../../format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { StatusChip } from '../products/StatusChip'
import { Icon } from '../shell/Icon'
import { partStatusTone, rowStatus, whereText } from './supplierView'

type Props = { row: SupplierOrderRow; store: string; onOpen: () => void }

// A part of an order as a stacked card (PortalOrders' supplier rows at phone width): the number and when, who it is for and where it goes, the items and the
// part's status. No total and no payment: a supplier reads neither. Times are UTC, which a supplier's seat reads no store settings to change.
export function SupplierOrderCard({ row, store, onOpen }: Props) {
  const { colors, radii } = useTheme()
  const status = rowStatus(row)
  const who = row.customerName ?? t('supplier.toShip.forStore', { store })
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('orders.row.open', { number: row.number })}
      onPress={onOpen}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
    >
      <View style={styles.text}>
        <Text style={[styles.number, { color: colors.text }]}>{row.number}</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{formatDateTime(row.placedAt, locale, 'UTC')}</Text>
        <Text numberOfLines={1} style={[styles.who, { color: colors.textStrong }]}>
          {who}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{whereText(row)}</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{tCount('orders.row.items', row.items)}</Text>
      </View>
      <View style={styles.right}>
        <StatusChip label={t(`supplier.status.${status}`)} tone={partStatusTone[status]} />
      </View>
      <Icon name="chevron" size={18} color={colors.muted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderWidth: 1, minHeight: 88 },
  text: { flex: 1, gap: 2 },
  number: { fontSize: 15, fontWeight: '800', fontFamily: 'monospace' },
  who: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 12 },
  right: { alignItems: 'flex-end', maxWidth: '42%' },
})
