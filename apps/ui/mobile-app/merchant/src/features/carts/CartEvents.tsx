import { StyleSheet, Text, View } from 'react-native'
import type { CartDetail } from '../../api/carts'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { SectionCard } from '../common/SectionCard'
import { agoText, eventsOf } from './cartText'

// What happened to the cart, newest first: leaving, each reminder and its click, a stop, and the order that recovered it.
export function CartEvents({ detail, country, now }: { detail: CartDetail; country: string | null; now: Date }) {
  const { colors } = useTheme()
  return (
    <SectionCard title={t('carts.page.happened')}>
      {eventsOf(detail, country).map((event) => (
        <View key={event.key} style={styles.event}>
          <View style={[styles.dot, { backgroundColor: event.tone === 'good' ? colors.success : event.tone === 'next' ? colors.info : colors.fieldBorder }]} />
          <View style={styles.text}>
            <Text style={[styles.what, { color: colors.text }]}>{event.what}</Text>
            {event.at ? <Text style={[styles.sub, { color: colors.muted }]}>{agoText(event.at, now)}</Text> : null}
          </View>
        </View>
      ))}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  event: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  text: { flex: 1, gap: 1 },
  what: { fontSize: 14, lineHeight: 20 },
  sub: { fontSize: 12 },
})
