import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { OrderShipment } from '../../api/order'
import { loadAccess } from '../../api/products'
import { loadSupplierOrder } from '../../api/supplier'
import { formatDateTime } from '../../format'
import { locale, t } from '../../messages'
import { sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { useLoad } from '../common/useLoad'
import { loadStateOf } from '../orders/loadState'
import { addressText } from '../orders/orderDetail'
import { OrderShipments } from '../orders/OrderShipments'
import { TrackingSheet } from '../orders/TrackingSheet'
import { StatusChip } from '../products/StatusChip'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { supplierAccessOf } from './access'
import { SupplierLines } from './SupplierLines'
import { SupplierShipSheet } from './SupplierShipSheet'
import { canSendNow, partStatus, partStatusTone, toStore } from './supplierView'

type Sheet = { kind: 'ship' } | { kind: 'tracking'; shipment: OrderShipment }

// An order as a supplier sees it (FIRST-RELEASE (store) §17, ACCESS.md §7.3; PortalOrders as a supplier): only its own items, where they go by the mode the order was
// placed under, and shipping them. A to-store part shows nothing of the shopper; a to-shopper part shows the name and delivery address, never the email or the phone.
// The API decides what is shown and every write again; an order that isn't this supplier's reads as not found.
export function SupplierOrderScreen({ id }: { id: string }) {
  const { colors } = useTheme()
  const client = sessionClient()
  const { state, online, acting } = useShell()
  const permissions = useLoad(() => loadAccess(client), [client])
  const loaded = useLoad(() => loadSupplierOrder(client, id), [client, id])
  const access = permissions.state.status === 'ready' ? supplierAccessOf(permissions.state.data, state?.readOnly === true) : null
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const { set } = loaded

  // Reads the order again without the skeleton, so what the person was looking at stays; a read that fails leaves it as it was.
  const refresh = useCallback(async () => {
    try {
      const fresh = await loadSupplierOrder(client, id)
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

  const store = acting.storeName
  const sending = toStore(order)
  const status = partStatus(order.parts[0]?.state, order.state)
  const canShip = access.canShip && canSendNow(order)

  return (
    <ShellScreen label={t('orders.detail.screen')} onRetry={retry}>
      <View style={styles.content}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.number, { color: colors.heading }]}>
            {order.number}
          </Text>
          <StatusChip label={t(`supplier.status.${status}`)} tone={partStatusTone[status]} />
          <Text style={[styles.placed, { color: colors.muted }]}>{t('orders.detail.placed', { time: formatDateTime(order.placedAt, locale, 'UTC') })}</Text>
        </View>

        {access.readOnly ? <Notice text={t('orders.detail.readOnly')} /> : null}
        <Notice text={sending ? t('supplier.order.noteToStore') : t('supplier.order.noteToShopper')} />

        {canShip ? <Button saves label={sending ? t('supplier.order.sendToStore') : t('orders.detail.actions.ship')} onPress={() => setSheet({ kind: 'ship' })} /> : null}

        <SupplierLines order={order} />
        <OrderShipments order={order} timeZone="UTC" canFulfil={access.canShip} supplier busy={false} onAddTracking={(shipment) => setSheet({ kind: 'tracking', shipment })} />

        {sending ? (
          <SectionCard title={t('supplier.order.sendTo.title')}>
            <Text style={[styles.text, { color: colors.text }]}>{store}</Text>
            <Text style={[styles.muted, { color: colors.muted }]}>{t('supplier.order.sendTo.body', { store })}</Text>
          </SectionCard>
        ) : order.shippingAddress ? (
          <SectionCard title={t('orders.detail.customer.deliverTo')}>
            {order.customerName ? <Text style={[styles.text, { color: colors.text }]}>{order.customerName}</Text> : null}
            <Text style={[styles.muted, { color: colors.muted }]}>{addressText(order.shippingAddress, order.customerName)}</Text>
          </SectionCard>
        ) : null}
      </View>

      {sheet?.kind === 'ship' ? <SupplierShipSheet order={order} store={store} client={client} onClose={() => setSheet(null)} onDone={refresh} /> : null}
      {sheet?.kind === 'tracking' ? <TrackingSheet shipment={sheet.shipment} client={client} onClose={() => setSheet(null)} onDone={refresh} /> : null}
    </ShellScreen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  head: { gap: 8 },
  number: { fontSize: 24, fontWeight: '800', fontFamily: 'monospace' },
  placed: { fontSize: 13 },
  text: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  muted: { fontSize: 13, lineHeight: 19 },
})
