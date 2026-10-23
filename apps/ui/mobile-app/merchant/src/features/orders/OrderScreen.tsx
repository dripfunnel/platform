import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadCouriers, loadOrder, receiveReturn, requestPickup, type OrderReturn, type OrderShipment } from '../../api/order'
import { loadStoreTimeZone } from '../../api/storeInfo'
import { loadAccess } from '../../api/products'
import { formatDateTime } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { sessionClient } from '../../session'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { useLoad } from '../common/useLoad'
import { StatusChip } from '../products/StatusChip'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { useWrite } from '../settings/useWrite'
import { ordersAccessOf } from './access'
import { CancelOrderSheet } from './CancelOrderSheet'
import { CancelReturnSheet } from './CancelReturnSheet'
import { loadStateOf } from './loadState'
import { MarkPaidSheet } from './MarkPaidSheet'
import { OrderCustomer } from './OrderCustomer'
import { OrderHistory } from './OrderHistory'
import { OrderLines } from './OrderLines'
import { OrderReturns } from './OrderReturns'
import { OrderShipments } from './OrderShipments'
import { OrderTotals } from './OrderTotals'
import { allLeft, awaitingPayment, canRefundNow, canShipNow, nothingSent, returnable } from './orderDetail'
import { merchantStatus, moneyText, paymentOf, statusTone } from './orderView'
import { RefundSheet } from './RefundSheet'
import { ReturnSheet } from './ReturnSheet'
import { ShipSheet } from './ShipSheet'
import { TrackingSheet } from './TrackingSheet'

type Sheet =
  | { kind: 'ship' }
  | { kind: 'return' }
  | { kind: 'refund'; from: OrderReturn | null }
  | { kind: 'cancel' }
  | { kind: 'paid' }
  | { kind: 'cancelReturn'; ret: OrderReturn }
  | { kind: 'tracking'; shipment: OrderShipment }

// An order (FIRST-RELEASE.md §6; PortalOrders detail at phone width): its lines by who packs them, shipments, returns, payment, the shopper and the
// history, with the actions this seat has. Every figure and every rule is the API's; the screen only offers what a seat may and says what it will do.
export function OrderScreen({ id }: { id: string }) {
  const { colors } = useTheme()
  const client = sessionClient()
  const { state, online } = useShell()
  const permissions = useLoad(() => loadAccess(client), [client])
  const loaded = useLoad(() => loadOrder(client, id), [client, id])
  const zone = useLoad(() => loadStoreTimeZone(client).then((known) => known ?? 'UTC', () => 'UTC'), [client])
  const access = permissions.state.status === 'ready' ? ordersAccessOf(permissions.state.data, state?.readOnly === true) : null
  const couriers = useLoad(() => (access?.canBook ? loadCouriers(client).catch((): string[] => []) : Promise.resolve<string[]>([])), [client, access?.canBook])
  const write = useWrite('orders')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const { set } = loaded

  // Reads the order again without the skeleton, so what the person was looking at stays; a read that fails leaves it as it was.
  const refresh = useCallback(async () => {
    try {
      const fresh = await loadOrder(client, id)
      if (fresh) set(fresh)
    } catch {
      // The write has been said already.
    }
  }, [client, id, set])

  const failure = permissions.state.status === 'error' ? permissions.state.error : loaded.state.status === 'error' ? loaded.state.error : null
  const retry = () => {
    permissions.reload()
    loaded.reload()
  }
  if (failure !== null) {
    return (
      <ShellScreen label={t('orders.detail.screen')} state={loadStateOf(failure, online)} onRetry={retry}>
        {null}
      </ShellScreen>
    )
  }
  if (access !== null && !access.canRead) {
    return (
      <ShellScreen label={t('orders.detail.screen')} state="denied">
        {null}
      </ShellScreen>
    )
  }
  if (loaded.state.status === 'ready' && loaded.state.data === null) {
    return (
      <ShellScreen label={t('orders.detail.screen')} state="notFound">
        {null}
      </ShellScreen>
    )
  }
  const order = loaded.state.status === 'ready' ? loaded.state.data : null
  if (order === null || access === null) {
    return (
      <ShellScreen label={t('orders.detail.screen')}>
        <Skeleton />
      </ShellScreen>
    )
  }

  const timeZone = zone.state.status === 'ready' ? zone.state.data : 'UTC'
  const close = () => setSheet(null)
  const status = merchantStatus(order.state, order.paymentState, order.fulfilmentState)
  const pay = paymentOf(order.paymentState)
  const payText = pay ? t(`orders.detail.pay.${pay}`, { amount: order.refunded ? moneyText(order.refunded) : '' }) : null

  const canShip = access.canShip && canShipNow(order) && Object.keys(allLeft(order)).length > 0
  const canMarkPaid = access.canMarkPaid && awaitingPayment(order)
  const canReturn = access.canRefund && returnable(order)
  const canRefund = access.canRefund && canRefundNow(order)
  const canCancel = access.canCancel && order.state === 'placed' && order.paymentState !== 'refunded' && nothingSent(order)

  const receive = (ret: OrderReturn) =>
    void write.run(async () => {
      await receiveReturn(client, ret.id)
      await refresh()
      return t('orders.detail.returns.received')
    })
  const askPickup = (shipment: OrderShipment) =>
    void write.run(async () => {
      await requestPickup(client, shipment.id)
      await refresh()
      return t('orders.detail.shipments.pickupRequested')
    })

  return (
    <ShellScreen label={t('orders.detail.screen')} onRetry={retry}>
      <View style={styles.content}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.number, { color: colors.heading }]}>
            {order.number}
          </Text>
          <View style={styles.chips}>
            <StatusChip label={t(`orders.status.${status}`)} tone={statusTone[status]} />
            {payText ? <StatusChip label={payText} tone={pay === 'pending' || pay === 'authorised' ? 'warning' : pay === 'paid' ? 'success' : 'neutral'} /> : null}
          </View>
          <Text style={[styles.placed, { color: colors.muted }]}>{t('orders.detail.placed', { time: formatDateTime(order.placedAt, locale, timeZone) })}</Text>
        </View>

        {access.readOnly ? <Notice text={t('orders.detail.readOnly')} /> : null}
        {order.test ? <Notice text={t('orders.detail.test')} /> : null}
        {write.failure ? <Notice kind="error" text={write.failure} /> : null}

        {canShip || canMarkPaid || canReturn || canRefund || canCancel ? (
          <View style={styles.actions}>
            {canShip ? <Button saves label={t('orders.detail.actions.ship')} onPress={() => setSheet({ kind: 'ship' })} /> : null}
            {canMarkPaid ? <Button kind="secondary" saves label={t('orders.detail.actions.markPaid')} onPress={() => setSheet({ kind: 'paid' })} /> : null}
            {canReturn ? <Button kind="secondary" saves label={t('orders.detail.actions.return')} onPress={() => setSheet({ kind: 'return' })} /> : null}
            {canRefund ? <Button kind="secondary" saves label={t('orders.detail.actions.refund')} onPress={() => setSheet({ kind: 'refund', from: null })} /> : null}
            {canCancel ? <Button kind="secondary" saves label={t('orders.detail.actions.cancel')} onPress={() => setSheet({ kind: 'cancel' })} /> : null}
          </View>
        ) : null}

        <OrderLines order={order} />
        <OrderShipments order={order} timeZone={timeZone} canFulfil={access.canShip} busy={write.busy} onAddTracking={(shipment) => setSheet({ kind: 'tracking', shipment })} onRequestPickup={askPickup} />
        <OrderReturns order={order} timeZone={timeZone} canRefund={access.canRefund} busy={write.busy} onReceive={receive} onCancel={(ret) => setSheet({ kind: 'cancelReturn', ret })} onRefund={(ret) => setSheet({ kind: 'refund', from: ret })} />
        <OrderTotals order={order} />
        <OrderCustomer order={order} canOpenCustomer={access.canOpenCustomer} />
        <OrderHistory order={order} timeZone={timeZone} />
      </View>

      {sheet?.kind === 'ship' ? <ShipSheet order={order} client={client} couriers={couriers.state.status === 'ready' ? couriers.state.data : []} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'return' ? <ReturnSheet order={order} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'refund' ? <RefundSheet order={order} from={sheet.from} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'cancel' ? <CancelOrderSheet order={order} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'paid' ? <MarkPaidSheet order={order} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'cancelReturn' ? <CancelReturnSheet ret={sheet.ret} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'tracking' ? <TrackingSheet shipment={sheet.shipment} client={client} onClose={close} onDone={refresh} /> : null}
    </ShellScreen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  head: { gap: 8 },
  number: { fontSize: 24, fontWeight: '800', fontFamily: 'monospace' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  placed: { fontSize: 13 },
  actions: { gap: 8 },
})
