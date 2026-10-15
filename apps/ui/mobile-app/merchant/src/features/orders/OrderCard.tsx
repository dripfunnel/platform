import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { OrderRow } from '../../api/orders'
import { formatDateTime } from '../../format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { StatusChip } from '../products/StatusChip'
import { Icon } from '../shell/Icon'
import { moneyText, paymentOf, rowStatus, statusTone } from './orderView'

type Props = { row: OrderRow; timeZone: string; onOpen: () => void }

// An order as a stacked card (DESIGN.md §4; PortalOrders' rows at phone width): the number and when, who and where, the items; on the
// right the total and how it was paid, with the status under it. Every figure is the API's.
export function OrderCard({ row, timeZone, onOpen }: Props) {
  const { colors, radii } = useTheme()
  const status = rowStatus(row)
  const pay = paymentOf(row.paymentState)
  const who = [row.customerName ?? t('orders.row.guest'), row.city].filter(Boolean).join(' · ')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('orders.row.open', { number: row.number })}
      onPress={onOpen}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
    >
      <View style={styles.text}>
        <Text style={[styles.number, { color: colors.text }]}>{row.number}</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{formatDateTime(row.placedAt, locale, timeZone)}</Text>
        <Text numberOfLines={1} style={[styles.who, { color: colors.textStrong }]}>
          {who}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{tCount('orders.row.items', row.items)}</Text>
      </View>
      <View style={styles.right}>
        {row.total ? <Text style={[styles.total, { color: colors.text }]}>{moneyText(row.total)}</Text> : null}
        {pay ? <Text style={[styles.pay, { color: pay === 'pending' || pay === 'authorised' ? colors.warning : colors.muted }]}>{t(`orders.payment.${pay}`)}</Text> : null}
        <StatusChip label={t(`orders.status.${status}`)} tone={statusTone[status]} />
        {row.test ? <Text style={[styles.sub, { color: colors.muted }]}>{t('orders.row.test')}</Text> : null}
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
  right: { alignItems: 'flex-end', gap: 3, maxWidth: '42%' },
  total: { fontSize: 15, fontWeight: '700' },
  pay: { fontSize: 12, fontWeight: '600' },
})
