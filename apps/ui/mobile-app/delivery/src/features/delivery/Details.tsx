import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { formatMoney } from '@dripfunnel/mobile-shared/format'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { RiderDelivery } from '../../api/delivery'
import { locale, t } from '../../messages'
import { Button } from '../common/ui'
import { addressLine } from './address'
import { DeliveryMap } from './DeliveryMap'
import { dial, navigateTo, type Pin } from './navigate'

const pinOf = ({ latitude, longitude }: { latitude: number | null; longitude: number | null }): Pin | null => (latitude !== null && longitude !== null ? { latitude, longitude } : null)

/** The cash to collect in the order's currency; null for a delivery paid online. */
export const cashOf = (delivery: RiderDelivery): string | null =>
  delivery.cashDueAmount !== null && delivery.currency !== null ? formatMoney({ amount: delivery.cashDueAmount, currency: delivery.currency }, locale) : null

function Card({ children }: { children: ReactNode }) {
  const { colors, radii } = useTheme()
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>{children}</View>
}

function Label({ children }: { children: string }) {
  const { colors } = useTheme()
  return <Text style={[styles.label, { color: colors.muted }]}>{children}</Text>
}

function Payment({ delivery }: { delivery: RiderDelivery }) {
  const { colors } = useTheme()
  const cash = cashOf(delivery)
  return (
    <View style={styles.row}>
      <Text style={{ color: colors.textStrong }}>{cash ? t('delivery.cashToCollect') : t('delivery.paid')}</Text>
      {cash ? <Text style={[styles.strong, { color: colors.heading }]}>{cash}</Text> : null}
    </View>
  )
}

/** Before pickup: where to collect the parcel, what is in it, and only the customer's area. */
export function PickupDetails({ delivery }: { delivery: RiderDelivery }) {
  const { colors } = useTheme()
  const name = delivery.warehouse?.name ?? t('home.warehouse')
  const pin = delivery.warehouse ? pinOf(delivery.warehouse) : null
  const lines = delivery.lines ?? []
  return (
    <>
      <Card>
        <Label>{t('delivery.pickUpFrom')}</Label>
        <Text style={[styles.strong, { color: colors.heading }]}>{name}</Text>
        <Text style={{ color: colors.text }}>{addressLine(delivery.warehouse?.address ?? null)}</Text>
        {pin ? <Button kind="secondary" label={t('delivery.navigate')} onPress={() => void navigateTo(pin, name)} /> : null}
      </Card>
      <Card>
        <Label>{t('delivery.items', { count: lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0) })}</Label>
        {lines.map((line, index) => (
          <View key={index} style={styles.row}>
            <Text style={{ color: colors.text, flex: 1 }}>{[line.name, line.versionName].filter(Boolean).join(' · ')}</Text>
            <Text style={[styles.strong, { color: colors.heading }]}>{t('delivery.quantity', { quantity: line.quantity ?? 0 })}</Text>
          </View>
        ))}
      </Card>
      <Card>
        <Label>{t('delivery.deliverTo')}</Label>
        <Text style={[styles.strong, { color: colors.heading }]}>{delivery.area ?? ''}</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{t('delivery.hiddenUntilPickup')}</Text>
        <Payment delivery={delivery} />
      </Card>
    </>
  )
}

/** After pickup: who and where, with Call and Navigate, the customer's note and what to collect. */
export function CustomerDetails({ delivery }: { delivery: RiderDelivery }) {
  const { colors, radii } = useTheme()
  const customer = delivery.customer
  const phone = customer?.phone ?? null
  const pin = customer ? pinOf(customer) : null
  const address = addressLine(customer?.address ?? null)
  return (
    <>
      <Card>
        <Label>{t('delivery.customer')}</Label>
        <View style={styles.row}>
          <Text style={[styles.strong, { color: colors.heading, flex: 1 }]}>{customer?.name ?? ''}</Text>
          {phone ? <Button kind="secondary" label={t('delivery.call')} onPress={() => void dial(phone)} /> : null}
        </View>
      </Card>
      <View style={[styles.mapCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
        {pin ? <DeliveryMap pin={pin} /> : null}
        <View style={styles.mapBody}>
          <Text style={{ color: colors.text, fontSize: 15 }}>{address}</Text>
          {pin ? <Button kind="secondary" label={t('delivery.navigate')} onPress={() => void navigateTo(pin, address)} /> : <Text style={{ color: colors.muted, fontSize: 13 }}>{t('delivery.noPin')}</Text>}
        </View>
      </View>
      {customer?.note ? (
        <Card>
          <Label>{t('delivery.customerNote')}</Label>
          <Text style={{ color: colors.text }}>{customer.note}</Text>
        </Card>
      ) : null}
      <Card>
        <Payment delivery={delivery} />
      </Card>
    </>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, gap: 8 },
  mapCard: { borderWidth: 1, overflow: 'hidden' },
  mapBody: { padding: 16, gap: 10 },
  label: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  strong: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
})
