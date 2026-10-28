import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { orderOperation } from '../../api/orders'
import { t } from '../../messages'
import { Resource, ScreenHeader, StateMessage } from '../common/ui'
import { useOperation } from '../common/useOperation'
import { clockTime, stepTime, zoneOf } from '../orders/time'
import { WithOrderAccess } from '../orders/WithOrderAccess'
import { HandoverCode } from './HandoverCode'
import { LiveMap } from './LiveMap'
import { RiderCard } from './RiderCard'
import { Steps } from './Steps'
import { trackingOf } from './tracking'
import { useLivePolling } from './useLivePolling'

/** An own delivery followed live (api/DELIVERY.md §7): asks again every 15 seconds while it is open and not over, and stops when the screen or the app goes away. */
export function TrackingScreen({ orderId }: { orderId: string }) {
  return (
    <WithOrderAccess orderId={orderId}>
      <Tracking orderId={orderId} />
    </WithOrderAccess>
  )
}

function Tracking({ orderId }: { orderId: string }) {
  const router = useRouter()
  const { colors, radii } = useTheme()
  const { state, retry, refresh } = useOperation(orderOperation(orderId))
  const read = state.status === 'ready' ? state.data : null
  const zone = zoneOf(read?.timeZone ?? null)
  const delivery = read?.order?.delivery ?? null
  const view = delivery ? trackingOf(delivery, (iso) => stepTime(iso, zone)) : null
  useLivePolling(refresh, view !== null && !view.ended)

  const toOrder = () => router.replace({ pathname: '/orders/[id]', params: { id: orderId } })
  const head = view ? (view.state === 'delivered' ? [colors.successSurface, colors.successBorder, colors.success] : view.state === 'failed' || view.state === 'cancelled' ? [colors.dangerSurface, colors.dangerBorder, colors.danger] : [colors.infoSurface, colors.infoBorder, colors.info]) : null

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t('tracking.title')} onBack={() => (router.canGoBack() ? router.back() : toOrder())} />
      <ScrollView contentContainerStyle={styles.body}>
        <Resource state={state} onRetry={retry} skeleton="detail">
          {({ order }) => {
            if (!order) return <StateMessage title={t('orders.notFound.title')} body={t('orders.notFound.body')} />
            if (!delivery) return <StateMessage title={t('tracking.none.title')} body={t('tracking.none.body')} actionLabel={t('tracking.none.action')} onAction={toOrder} />
            if (!view || !head) return <StateMessage title={t('tracking.unknown.title')} body={t('tracking.unknown.body')} actionLabel={t('states.retry')} onAction={retry} />
            const name = view.rider?.name ?? ''
            return (
              <>
                <View accessibilityRole="summary" style={[styles.head, { backgroundColor: head[0], borderColor: head[1], borderRadius: radii.card }]}>
                  <Text accessibilityRole="header" style={{ color: head[2], fontSize: 20, fontWeight: '800' }}>
                    {view.status}
                  </Text>
                  <Text style={{ color: colors.textStrong, fontSize: 15 }}>{view.lead}</Text>
                </View>
                {view.code ? <HandoverCode code={view.code} /> : null}
                {view.rider ? <RiderCard rider={view.rider} /> : null}
                {view.state === 'picked_up' ? (
                  <View style={styles.map}>
                    {view.position ? <LiveMap position={view.position} name={name} /> : <Text style={{ color: colors.textStrong, fontSize: 14 }}>{t('tracking.map.waiting', { name })}</Text>}
                    {view.etaAt ? <Text style={{ color: colors.heading, fontSize: 16, fontWeight: '800' }}>{t('tracking.map.eta', { time: clockTime(view.etaAt, zone) })}</Text> : null}
                    {view.position?.reportedAt ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('tracking.map.updated', { time: clockTime(view.position.reportedAt, zone) })}</Text> : null}
                  </View>
                ) : null}
                <Steps steps={view.steps} />
              </>
            )
          }}
        </Resource>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 16, padding: 16, paddingBottom: 40 },
  head: { gap: 6, padding: 16, borderWidth: 1 },
  map: { gap: 8 },
})
