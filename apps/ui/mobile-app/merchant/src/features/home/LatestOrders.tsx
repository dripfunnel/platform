import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { HomeOrder } from '../../api/home'
import { t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Eyebrow } from '../common/Eyebrow'
import { LinkButton } from '../common/LinkButton'
import { moneyText, statusTone } from '../orders/orderView'
import { StatusChip } from '../products/StatusChip'
import { orderStatusOf } from './homeView'

type Props = { orders: readonly HomeOrder[]; onOpen: (id: string) => void; onSeeAll: () => void }

// The newest orders as stacked rows with "See all" (DESIGN.md §3). A seat with no money gets the item count where the total would be.
export function LatestOrders({ orders, onOpen, onSeeAll }: Props) {
  const { colors, radii } = useTheme()
  return (
    <View style={styles.group}>
      <View style={styles.head}>
        <Eyebrow text={t('home.latest.title')} />
        <LinkButton label={t('home.latest.all')} onPress={onSeeAll} />
      </View>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
        {orders.map((order, index) => {
          const status = orderStatusOf(order)
          return (
            <Pressable
              key={order.id}
              accessibilityRole="button"
              accessibilityLabel={t('orders.row.open', { number: order.number })}
              onPress={() => onOpen(order.id)}
              style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <View style={styles.text}>
                <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
                  {order.customerName ?? t('orders.row.guest')}
                </Text>
                <Text style={[styles.number, { color: colors.muted }]}>{order.number}</Text>
              </View>
              <View style={styles.right}>
                <Text style={[styles.total, { color: colors.text }]}>{order.total ? moneyText(order.total) : tCount('orders.row.items', order.items)}</Text>
                <StatusChip label={t(`orders.status.${status}`)} tone={statusTone[status]} />
              </View>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  card: { borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700' },
  number: { fontSize: 11, fontFamily: 'monospace' },
  right: { alignItems: 'flex-end', gap: 4 },
  total: { fontSize: 14, fontWeight: '600' },
})
