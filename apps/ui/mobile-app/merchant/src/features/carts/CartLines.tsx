import { StyleSheet, Text, View } from 'react-native'
import type { CartDetail } from '../../api/carts'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { SectionCard } from '../common/SectionCard'
import { moneyText, stockText } from './cartText'

// The cart as it would be bought now: today's price and stock for each line, out-of-stock ones marked, and the value the API worked out.
export function CartLines({ detail, shipWord }: { detail: CartDetail; shipWord: string }) {
  const { colors } = useTheme()
  const { cart, lines } = detail
  return (
    <SectionCard title={t('carts.page.inCart')}>
      {lines.map((line) => (
        <View key={line.versionId} style={styles.line}>
          <View style={styles.text}>
            <Text style={[styles.name, { color: colors.text }]}>{[line.name ?? t('carts.item'), line.versionName].filter(Boolean).join(' · ')}</Text>
            <Text style={[styles.sub, { color: line.outOfStock ? colors.danger : colors.muted }]}>{t('carts.page.qty', { count: formatNumber(line.quantity, locale), stock: stockText(line) })}</Text>
          </View>
          <Text style={[styles.total, { color: colors.text }]}>{line.lineTotal ? moneyText(line.lineTotal) : '—'}</Text>
        </View>
      ))}
      <View style={[styles.sum, { borderColor: colors.border }]}>
        <Text style={[styles.name, { color: colors.text }]}>{t('carts.page.value')}</Text>
        <Text style={[styles.total, { color: colors.text }]}>{cart.value ? moneyText(cart.value) : '—'}</Text>
      </View>
      <Text style={[styles.sub, { color: colors.muted }]}>{t('carts.page.valueNote', { ship: shipWord })}</Text>
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontWeight: '700' },
  total: { fontSize: 14, fontWeight: '700' },
  sub: { fontSize: 13, lineHeight: 18 },
  sum: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: 10 },
})
