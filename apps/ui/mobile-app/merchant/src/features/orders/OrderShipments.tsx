import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import type { OrderShipment } from '../../api/order'
import { formatDateTime, formatList, formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { SectionCard } from '../common/SectionCard'
import { isHttps } from './https'
import { lineName } from './orderDetail'

type Props = {
  order: { parts: readonly { lines: readonly { id: string; name: string; versionName: string | null }[] }[]; shipments: readonly OrderShipment[] }
  timeZone: string
  /** `orders.fulfil`, and the store's own shipments only: a supplier's tracking is the supplier's. */
  canFulfil: boolean
  /** A supplier's seat: every shipment listed is its own. */
  supplier?: boolean
  busy: boolean
  onAddTracking: (shipment: OrderShipment) => void
  /** Absent for a supplier, which never books a label here. */
  onRequestPickup?: (shipment: OrderShipment) => void
}

const whenText = (shipment: OrderShipment, timeZone: string): string => {
  const time = formatDateTime(shipment.shippedAt, locale, timeZone)
  if (shipment.kind === 'sent_to_store') return t('orders.detail.shipments.sentToStore', { time })
  if (shipment.kind === 'pickup') return t('orders.detail.shipments.pickup', { time })
  return t(shipment.kind === 'booked' ? 'orders.detail.shipments.booked' : 'orders.detail.shipments.shipped', { time, place: shipment.warehouseName })
}

// What has left: each shipment's items and tracking, adding tracking to one sent without it, and asking the courier to collect a label booked here.
export function OrderShipments({ order, timeZone, canFulfil, supplier = false, busy, onAddTracking, onRequestPickup }: Props) {
  const { colors } = useTheme()
  if (order.shipments.length === 0) return null
  const names = new Map(order.parts.flatMap((part) => part.lines.map((line) => [line.id, lineName(line)] as const)))
  return (
    <SectionCard title={t('orders.detail.shipments.title')}>
      {order.shipments.map((shipment) => {
        const own = supplier || shipment.supplierId === null
        const link = shipment.trackingUrl
        return (
          <View key={shipment.id} style={[styles.shipment, { borderColor: colors.border }]}>
            <Text style={[styles.sub, { color: colors.muted }]}>{whenText(shipment, timeZone)}</Text>
            <Text style={[styles.text, { color: colors.text }]}>{formatList(shipment.lines.map((line) => t('orders.detail.shipments.item', { count: formatNumber(line.quantity, locale), name: names.get(line.lineId) ?? '' })), locale)}</Text>
            {shipment.trackingNumber ? (
              <>
                <Text style={[styles.text, { color: colors.text }]}>
                  {shipment.courierName ? t('orders.detail.shipments.tracking', { courier: shipment.courierName, number: shipment.trackingNumber }) : t('orders.detail.shipments.trackingOnly', { number: shipment.trackingNumber })}
                </Text>
                {link && isHttps(link) ? (
                  <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(link)} style={styles.link}>
                    <Text style={[styles.linkText, { color: colors.link }]}>{t('orders.detail.shipments.track')}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : shipment.kind !== 'pickup' ? (
              <Text style={[styles.sub, { color: colors.muted }]}>{t('orders.detail.shipments.noTracking')}</Text>
            ) : null}
            {canFulfil && own && shipment.kind === 'manual' && !shipment.trackingNumber ? <Button kind="secondary" saves label={t('orders.detail.shipments.add')} disabled={busy} onPress={() => onAddTracking(shipment)} /> : null}
            {shipment.kind === 'booked' && shipment.pickupRequestedAt !== null ? <Text style={[styles.sub, { color: colors.muted }]}>{t('orders.detail.shipments.pickupAsked')}</Text> : null}
            {canFulfil && own && onRequestPickup && shipment.kind === 'booked' && shipment.pickupRequestedAt === null ? <Button kind="secondary" saves label={t('orders.detail.shipments.requestPickup')} disabled={busy} onPress={() => onRequestPickup(shipment)} /> : null}
          </View>
        )
      })}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  shipment: { gap: 6, paddingTop: 10, borderTopWidth: 1 },
  text: { fontSize: 14, lineHeight: 20 },
  sub: { fontSize: 13 },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { fontSize: 14, fontWeight: '700' },
})
