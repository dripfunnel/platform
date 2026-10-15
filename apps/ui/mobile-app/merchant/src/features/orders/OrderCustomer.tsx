import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text } from 'react-native'
import type { Order } from '../../api/order'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { SectionCard } from '../common/SectionCard'
import { addressText } from './orderDetail'
import { customerHref } from './routes'

type Props = { order: Order; canOpenCustomer: boolean }

// The shopper: name (opening their page in Customers for a seat that reads customers), contact, where it goes, the market and their note.
export function OrderCustomer({ order, canOpenCustomer }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const name = order.customerName ?? t('orders.detail.customer.guest')
  const customerId = order.customerId
  return (
    <SectionCard title={t('orders.detail.customer.title')}>
      {canOpenCustomer && customerId ? (
        <Pressable accessibilityRole="link" accessibilityLabel={t('orders.detail.customer.open', { name })} onPress={() => router.push(customerHref(customerId) as never)} style={styles.link}>
          <Text style={[styles.name, { color: colors.link }]}>{name}</Text>
        </Pressable>
      ) : (
        <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
      )}
      {order.email ? <Text style={[styles.text, { color: colors.textStrong }]}>{order.email}</Text> : null}
      {order.phone ? <Text style={[styles.text, { color: colors.textStrong }]}>{order.phone}</Text> : null}
      {order.shippingOption === 'pickup' ? (
        <Text style={[styles.text, { color: colors.textStrong }]}>{t('orders.detail.customer.pickup')}</Text>
      ) : order.shippingAddress ? (
        <>
          <Text style={[styles.heading, { color: colors.text }]}>{t('orders.detail.customer.deliverTo')}</Text>
          <Text style={[styles.text, { color: colors.textStrong }]}>{addressText(order.shippingAddress, order.customerName)}</Text>
        </>
      ) : null}
      {order.marketName ? <Text style={[styles.sub, { color: colors.muted }]}>{t('orders.detail.customer.market', { market: order.marketName })}</Text> : null}
      {order.shopperNote ? (
        <>
          <Text style={[styles.heading, { color: colors.text }]}>{t('orders.detail.customer.shopperNote')}</Text>
          <Text style={[styles.text, { color: colors.textStrong }]}>{order.shopperNote}</Text>
        </>
      ) : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  link: { minHeight: 44, justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700' },
  heading: { fontSize: 13, fontWeight: '700' },
  text: { fontSize: 14, lineHeight: 20 },
  sub: { fontSize: 13 },
})
