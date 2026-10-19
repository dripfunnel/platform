import { StyleSheet, Text, View } from 'react-native'
import type { CartSummary } from '../../api/carts'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { moneyList } from './cartText'

// The last 14 days (the prototype's tiles): checkouts left, reminders sent, recovered and recovered sales, all the API's figures. The share
// of reachable carts is only a division of two of them, as the web portal shows it.
export function CartTiles({ summary }: { summary: CartSummary }) {
  const { colors, radii } = useTheme()
  const share = summary.reachable > 0 ? Math.round((summary.recovered / summary.reachable) * 100) : null
  const tiles = [
    { key: 'abandoned', label: t('carts.tiles.abandoned'), value: formatNumber(summary.abandoned, locale), sub: t('carts.tiles.leftBehind', { amount: moneyList(summary.leftBehind) }), good: false },
    { key: 'sent', label: t('carts.tiles.sent'), value: formatNumber(summary.remindersSent, locale), sub: tCount('carts.tiles.reachable', summary.reachable), good: false },
    { key: 'recovered', label: t('carts.tiles.recovered'), value: formatNumber(summary.recovered, locale), sub: share === null ? '—' : t('carts.tiles.pct', { pct: share }), good: true },
    { key: 'sales', label: t('carts.tiles.sales'), value: moneyList(summary.recoveredSales), sub: tCount('carts.tiles.withCode', summary.recoveredWithCode), good: true },
  ]
  return (
    <View style={styles.block}>
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <View key={tile.key} style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.tile }]}>
            <Text style={[styles.label, { color: colors.muted }]}>{tile.label}</Text>
            <Text style={[styles.value, { color: tile.good ? colors.success : colors.text }]}>{tile.value}</Text>
            <Text style={[styles.sub, { color: colors.muted }]}>{tile.sub}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.sub, { color: colors.muted }]}>{t('carts.tiles.note', { days: summary.days })}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, padding: 12, gap: 2 },
  label: { fontSize: 12 },
  value: { fontSize: 20, fontWeight: '800' },
  sub: { fontSize: 12, lineHeight: 17 },
})
