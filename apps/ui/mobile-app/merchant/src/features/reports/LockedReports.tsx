import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Notice } from '../common/Notice'

// Below the plan that has Reports (the prototype's locked view): it names the plan that unlocks it and has no upgrade action, since plans are not in the app (DESIGN.md §5).
export function LockedReports({ plan, canAsk }: { plan: string | null; canAsk: boolean }) {
  const { colors, radii } = useTheme()
  const name = plan ?? t('reports.locked.somePlan')
  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('reports.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('reports.locked.rangeLine', { plan: name })}</Text>
      </View>
      <Notice text={`${t('reports.thin.title')} ${t('reports.locked.body', { plan: name })}`} />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
        <Text accessibilityRole="header" style={[styles.cardTitle, { color: colors.heading }]}>
          {t('reports.locked.title')}
        </Text>
        <Text style={[styles.big, { color: colors.heading }]}>{name}</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('reports.locked.note')}</Text>
        {canAsk ? <Text style={[styles.sub, { color: colors.textStrong }]}>{t('reports.locked.askOwner')}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 14, paddingBottom: 32, gap: 16 },
  head: { gap: 2 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  card: { borderWidth: 1, padding: 16, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  big: { fontSize: 28, fontWeight: '800' },
})
