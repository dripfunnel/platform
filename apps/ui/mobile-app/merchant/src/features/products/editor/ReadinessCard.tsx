import { StyleSheet, Text, View } from 'react-native'
import type { EditorProduct } from '../../../api/products'
import { t, tryT } from '../../../messages'
import { useTheme } from '../../../theme'
import { SectionCard } from '../../common/SectionCard'

type Props = { readiness: EditorProduct['readiness']; saved: boolean }

const missingText = (codes: readonly string[]): string => codes.map((code) => tryT(`products.needs.${code}`) ?? code).join(', ')

// Ready to sell in each market (CATALOG-DESIGN.md T): what the API says is missing for each country, so a gap stops sales
// there only. A supplier reads no market, so it never sees this card.
export function ReadinessCard({ readiness, saved }: Props) {
  const { colors } = useTheme()
  if (readiness === null) return null
  const elsewhere = readiness.some((market) => market.missing.some((code) => code !== 'price'))
  return (
    <SectionCard title={t('products.ready.title')}>
      {!saved ? <Text style={[styles.note, { color: colors.muted }]}>{t('products.ready.afterSave')}</Text> : null}
      {saved
        ? readiness.map((market) => (
            <View key={market.marketId} style={styles.row} accessible accessibilityLabel={`${market.marketName}: ${market.ready ? t('products.ready.ok') : t('products.ready.add', { missing: missingText(market.missing) })}`}>
              <Text style={[styles.mark, { color: market.ready ? colors.success : colors.warning }]}>{market.ready ? '✓' : '⚠'}</Text>
              <View style={styles.text}>
                <Text style={[styles.name, { color: colors.text }]}>{market.marketName}</Text>
                <Text style={{ color: market.ready ? colors.success : colors.warning, fontSize: 13 }}>{market.ready ? t('products.ready.ok') : t('products.ready.add', { missing: missingText(market.missing) })}</Text>
              </View>
            </View>
          ))
        : null}
      {saved ? <Text style={[styles.note, { color: colors.muted }]}>{t('products.ready.note')}</Text> : null}
      {saved && elsewhere ? <Text style={[styles.note, { color: colors.muted }]}>{t('products.ready.onWeb')}</Text> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  mark: { width: 20, fontSize: 16, fontWeight: '700' },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 19 },
})
