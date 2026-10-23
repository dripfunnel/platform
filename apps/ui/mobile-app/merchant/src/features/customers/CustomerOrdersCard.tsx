import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Customer } from '../../api/customers'
import { formatDateTime, formatMoney } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { SectionCard } from '../common/SectionCard'
import { orderStatusOf } from './customerFacts'

type Props = { customer: Customer; timeZone: string; onOpen: (orderId: string) => void }

// Their newest orders, as many as the API sends, each opening that order; the total says how many there are in all.
export function CustomerOrdersCard({ customer, timeZone, onOpen }: Props) {
  const { colors, radii } = useTheme()
  if (customer.orders.length === 0) return null
  return (
    <SectionCard title={t('customers.detail.ordersTitle')} sub={customer.ordersCount > customer.orders.length ? t('customers.detail.moreOrders', { count: customer.orders.length, total: customer.ordersCount }) : undefined}>
      {customer.orders.map((order) => (
        <Pressable
          key={order.id}
          accessibilityRole="button"
          accessibilityLabel={t('customers.detail.openOrder', { number: order.number })}
          onPress={() => onOpen(order.id)}
          style={({ pressed }) => [styles.row, { borderColor: colors.border, borderRadius: radii.button, backgroundColor: pressed ? colors.hover : colors.surface }]}
        >
          <View style={styles.text}>
            <Text style={[styles.number, { color: colors.link }]}>{order.number}</Text>
            <Text style={[styles.sub, { color: colors.muted }]}>
              {t('customers.detail.order', { date: formatDateTime(order.placedAt, locale, timeZone), status: t(`customers.detail.status.${orderStatusOf(order.state, order.paymentState, order.fulfilmentState)}`) })}
            </Text>
          </View>
          <Text style={[styles.total, { color: colors.text }]}>{formatMoney(order.total, locale)}</Text>
        </Pressable>
      ))}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  row: { minHeight: 56, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 2 },
  number: { fontSize: 14, fontWeight: '700' },
  sub: { fontSize: 13, lineHeight: 18 },
  total: { fontSize: 14, fontWeight: '700' },
})
