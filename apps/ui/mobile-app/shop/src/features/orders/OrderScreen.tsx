import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { orderOperation, type Order } from '../../api/orders'
import { t } from '../../messages'
import { money } from '../catalogue/words'
import { paymentName } from '../checkout/words'
import { Button, Resource, ScreenHeader, StateMessage } from '../common/ui'
import { useOperation } from '../common/useOperation'
import { useRefreshOnFocus } from '../common/useRefreshOnFocus'
import { trackingOf } from '../tracking/tracking'
import { StatusPill } from './StatusPill'
import { orderStatus, paymentOf } from './status'
import { orderDay, stepTime, zoneOf } from './time'
import { WithOrderAccess } from './WithOrderAccess'

/** One order: its lines, totals, payment and delivery method, and for an own delivery where it stands, with the way to follow it live. */
export function OrderScreen({ orderId }: { orderId: string }) {
  return (
    <WithOrderAccess orderId={orderId}>
      <Order orderId={orderId} />
    </WithOrderAccess>
  )
}

function Order({ orderId }: { orderId: string }) {
  const router = useRouter()
  const { colors } = useTheme()
  const { state, retry, refresh } = useOperation(orderOperation(orderId))
  useRefreshOnFocus(refresh)
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t('orders.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/orders'))} />
      <ScrollView contentContainerStyle={styles.body}>
        <Resource state={state} onRetry={retry} skeleton="detail">
          {({ order, timeZone }) =>
            order ? <Body order={order} zone={zoneOf(timeZone)} onTrack={() => router.push({ pathname: '/orders/[id]/track', params: { id: orderId } })} /> : <StateMessage title={t('orders.notFound.title')} body={t('orders.notFound.body')} />
          }
        </Resource>
      </ScrollView>
    </View>
  )
}

function Body({ order, zone, onTrack }: { order: Order; zone: string; onTrack: () => void }) {
  const { colors, radii } = useTheme()
  const cancelled = order.state === 'cancelled'
  const tracking = order.delivery ? trackingOf(order.delivery, (iso) => stepTime(iso, zone)) : null
  const awaiting = !cancelled && paymentOf(order) === 'awaiting' && order.paymentDueBy
  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]
  return (
    <>
      <View style={styles.title}>
        <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 24, fontWeight: '800' }}>
          {t('orders.order', { number: order.number })}
        </Text>
        <StatusPill status={orderStatus(order, order.delivery?.state ?? null)} />
        {order.placedAt ? <Text style={{ color: colors.muted, fontSize: 14 }}>{t('orders.placedOn', { date: orderDay(order.placedAt, zone) })}</Text> : null}
      </View>

      {cancelled ? <Text style={{ color: colors.danger, fontSize: 14, fontWeight: '600' }}>{t('orders.cancelledNote')}</Text> : null}
      {awaiting ? <Text style={{ color: colors.warning, fontSize: 14, fontWeight: '600' }}>{t('orders.payBy', { date: orderDay(awaiting, zone) })}</Text> : null}

      {tracking ? (
        <View style={card}>
          <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 16, fontWeight: '800' }}>
            {t('orders.delivery.title')}
          </Text>
          <Text style={{ color: colors.heading, fontSize: 15, fontWeight: '700' }}>{tracking.status}</Text>
          <Text style={{ color: colors.textStrong, fontSize: 14 }}>{tracking.lead}</Text>
          <Button kind="secondary" label={t('orders.delivery.track')} onPress={onTrack} />
        </View>
      ) : null}

      <View style={card}>
        <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 16, fontWeight: '800' }}>
          {t('orders.itemsTitle')}
        </Text>
        {order.lines.map((line, i) => (
          <View key={`${line.name}-${i}`} style={styles.line}>
            <View style={styles.lineText}>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{line.name}</Text>
              {line.versionName ? <Text style={{ color: colors.muted, fontSize: 13 }}>{line.versionName}</Text> : null}
              <Text style={{ color: colors.muted, fontSize: 13 }}>{t('orders.quantity', { count: line.quantity })}</Text>
            </View>
            {line.lineTotal ? <Text style={{ color: colors.text, fontSize: 15 }}>{money(line.lineTotal)}</Text> : null}
          </View>
        ))}
      </View>

      <View style={card}>
        <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 16, fontWeight: '800' }}>
          {t('orders.summary.title')}
        </Text>
        {order.subtotal ? <Row label={t('orders.summary.subtotal')} value={money(order.subtotal)} /> : null}
        {order.discounts.map((d, i) => (
          <Row key={`${d.name}-${i}`} label={d.name} value={`−${money(d.amount)}`} />
        ))}
        {order.shipping ? <Row label={t('orders.summary.shipping')} value={money(order.shipping)} /> : null}
        {order.tax && !order.pricesIncludeTax ? <Row label={t('orders.summary.tax')} value={money(order.tax)} /> : null}
        {order.giftCard ? <Row label={t('orders.summary.giftCard')} value={`−${money(order.giftCard)}`} /> : null}
        {order.total ? <Row label={t('orders.summary.total')} value={money(order.total)} strong /> : null}
        {order.tax && order.pricesIncludeTax ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('orders.summary.taxIncluded', { tax: money(order.tax) })}</Text> : null}
      </View>

      <View style={card}>
        {order.paymentMethod ? <Row label={t('orders.details.payment')} value={paymentName(order.paymentMethod)} /> : null}
        {order.shippingMethod ? <Row label={t('orders.details.method')} value={order.shippingMethod} /> : null}
      </View>
    </>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const { colors } = useTheme()
  return (
    <View style={styles.row}>
      <Text style={{ color: strong ? colors.heading : colors.textStrong, fontSize: strong ? 17 : 14, fontWeight: strong ? '800' : '500', flexShrink: 1 }}>{label}</Text>
      <Text style={{ color: strong ? colors.heading : colors.text, fontSize: strong ? 17 : 14, fontWeight: strong ? '800' : '500' }}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 14, padding: 16, paddingBottom: 40 },
  title: { gap: 8 },
  card: { gap: 10, padding: 14, borderWidth: 1 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineText: { flex: 1, gap: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
})
