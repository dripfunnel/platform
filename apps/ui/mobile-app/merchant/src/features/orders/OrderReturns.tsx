import { StyleSheet, Text, View } from 'react-native'
import type { Order, OrderReturn } from '../../api/order'
import { formatDateTime, formatList, formatNumber } from '../../format'
import { locale, t, tryT } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { SectionCard } from '../common/SectionCard'
import { StatusChip } from '../products/StatusChip'
import type { Tone } from '../products/productView'
import { leftInReturn, lineName } from './orderDetail'

type ReturnState = 'requested' | 'received' | 'refunded' | 'cancelled'

const tones: Record<ReturnState, Tone> = { requested: 'warning', received: 'warning', refunded: 'success', cancelled: 'neutral' }
const stateOf = (ret: OrderReturn): ReturnState => (ret.state === 'received' || ret.state === 'refunded' || ret.state === 'cancelled' ? ret.state : 'requested')

type Props = {
  order: Order
  timeZone: string
  /** `orders.refund`: marking received and cancelling a return are the store's, as refunding is. */
  canRefund: boolean
  busy: boolean
  onReceive: (ret: OrderReturn) => void
  onCancel: (ret: OrderReturn) => void
  onRefund: (ret: OrderReturn) => void
}

// Each return (PortalOrders): On its way back, then Received, then Refunded; or Cancelled while it is on its way back.
export function OrderReturns({ order, timeZone, canRefund, busy, onReceive, onCancel, onRefund }: Props) {
  const { colors } = useTheme()
  const lines = new Map(order.parts.flatMap((part) => part.lines.map((line) => [line.id, { name: lineName(line), supplier: part.supplierName }] as const)))
  return (
    <>
      {order.returns.map((ret) => {
        const state = stateOf(ret)
        const suppliers = [...new Set(ret.lines.map((line) => lines.get(line.lineId)?.supplier).filter((supplier): supplier is string => Boolean(supplier)))]
        const sub = { reason: tryT(`orders.detail.returns.reasons.${ret.reason}`) ?? ret.reason, time: formatDateTime(ret.startedAt, locale, timeZone) }
        const owed = ret.lines.some((line) => lines.has(line.lineId) && leftInReturn(order, ret, line.lineId) > 0)
        return (
          <SectionCard key={ret.id} title={t('orders.detail.returns.title', { number: ret.number })}>
            <StatusChip label={t(`orders.detail.returns.states.${state}`)} tone={tones[state]} />
            <Text style={[styles.text, { color: colors.text }]}>{formatList(ret.lines.map((line) => t('orders.detail.shipments.item', { count: formatNumber(line.quantity, locale), name: lines.get(line.lineId)?.name ?? '' })), locale)}</Text>
            <Text style={[styles.sub, { color: colors.muted }]}>{suppliers.length > 0 ? t('orders.detail.returns.suppliersRefund', { ...sub, suppliers: formatList(suppliers, locale) }) : t('orders.detail.returns.sub', sub)}</Text>
            {canRefund && state === 'requested' ? (
              <View style={styles.actions}>
                <Button kind="secondary" saves label={t('orders.detail.returns.receive')} disabled={busy} onPress={() => onReceive(ret)} />
                <Button kind="secondary" saves label={t('orders.detail.returns.cancel')} disabled={busy} onPress={() => onCancel(ret)} />
              </View>
            ) : null}
            {canRefund && state === 'received' && owed ? <Button kind="secondary" saves label={t('orders.detail.returns.refundThese')} disabled={busy} onPress={() => onRefund(ret)} /> : null}
          </SectionCard>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 14, lineHeight: 20 },
  sub: { fontSize: 13, lineHeight: 18 },
  actions: { gap: 8 },
})
