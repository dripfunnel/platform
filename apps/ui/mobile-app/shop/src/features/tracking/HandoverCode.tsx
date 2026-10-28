import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'

/** The code the customer reads out at the door (api/DELIVERY.md §3). Never logged, never kept, and never in a push or an email. */
export function HandoverCode({ code }: { code: string }) {
  const { colors, radii } = useTheme()
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.brand, borderRadius: radii.card }]}>
      <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 16, fontWeight: '800' }}>
        {t('tracking.code.title')}
      </Text>
      <Text style={{ color: colors.textStrong, fontSize: 14 }}>{t('tracking.code.give')}</Text>
      <Text accessibilityLabel={t('tracking.code.label', { code: code.split('').join(' ') })} selectable style={[styles.code, { color: colors.heading }]}>
        {code}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{t('tracking.code.hint')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: 8, padding: 16, borderWidth: 2 },
  code: { fontSize: 44, fontWeight: '800', letterSpacing: 12, textAlign: 'center', paddingVertical: 6 },
})
