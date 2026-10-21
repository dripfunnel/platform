import { StyleSheet, Text, View } from 'react-native'
import type { Order } from '../../api/order'
import { formatDateTime } from '../../format'
import { locale, t } from '../../messages'
import { useTheme } from '../../theme'
import { SectionCard } from '../common/SectionCard'
import { eventText } from './orderDetail'

// What has happened to the order, newest first, with who did it; the times are in the store's zone. Adding a team note is not in this release.
export function OrderHistory({ order, timeZone }: { order: Order; timeZone: string }) {
  const { colors } = useTheme()
  return (
    <SectionCard title={t('orders.detail.history.title')}>
      {order.history.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('orders.detail.history.empty')}</Text> : null}
      {order.history.map((event) => (
        <View key={event.id} style={styles.event}>
          <Text style={[styles.sub, { color: colors.muted }]}>{formatDateTime(event.at, locale, timeZone)}</Text>
          <Text style={[styles.text, { color: colors.text }]}>{eventText(event)}</Text>
        </View>
      ))}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  event: { gap: 2 },
  text: { fontSize: 14, lineHeight: 20 },
  sub: { fontSize: 12 },
})
