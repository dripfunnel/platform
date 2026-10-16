import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '../../theme'

const steps = ['choose', 'check', 'import', 'done'] as const

// Choose → Check → Import → Done (CatImport); the current one is named for a screen reader, since colour alone doesn't say it.
export function ImportSteps({ current }: { current: number }) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={t('imports.steps.label', { number: current + 1, step: t(`imports.steps.${steps[current] ?? 'choose'}`) })} style={styles.row}>
      {steps.map((step, index) => (
        <View key={step} style={styles.step}>
          <View style={[styles.bar, { backgroundColor: index <= current ? colors.brand : colors.border }]} />
          <Text style={[styles.label, { color: index === current ? colors.heading : colors.muted, fontWeight: index === current ? '800' : '600' }]}>{t(`imports.steps.${step}`)}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  step: { flex: 1, gap: 6 },
  bar: { height: 4, borderRadius: 2 },
  label: { fontSize: 12 },
})
