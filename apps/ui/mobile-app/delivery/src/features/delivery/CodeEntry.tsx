import { StyleSheet, Text, View } from 'react-native'
import { pluralForm } from '@dripfunnel/mobile-shared/format'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { locale, t } from '../../messages'
import { Field } from '../common/ui'

/** Wrong codes the API allows before it locks the delivery (docs/api/DELIVERY.md §3). */
export const wrongTriesAllowed = 5

export const triesLeft = (wrong: number): string => {
  const left = Math.max(0, wrongTriesAllowed - wrong)
  return pluralForm(locale, { one: t('delivery.code.triesLeft.one', { count: left }), other: t('delivery.code.triesLeft.other', { count: left }) }, left)
}

/** The customer's four digits, typed by the rider at the door. */
export function CodeEntry({ code, onChange, wrong, refusal }: { code: string; onChange: (code: string) => void; wrong: number; refusal: string | null }) {
  const { colors } = useTheme()
  return (
    <View style={styles.box}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('delivery.code.title')}
      </Text>
      <Text style={{ color: colors.textStrong }}>{t('delivery.code.body')}</Text>
      <Field
        label={t('delivery.code.label')}
        value={code}
        onChangeText={(next) => onChange(next.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        error={refusal ? `${refusal} ${triesLeft(wrong)}` : null}
      />
    </View>
  )
}

export function CodeLocked() {
  const { colors, radii } = useTheme()
  return (
    <View accessibilityRole="alert" style={[styles.locked, { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder, borderRadius: radii.card }]}>
      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 16 }}>{t('delivery.code.lockedTitle')}</Text>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{t('delivery.code.lockedSteps')}</Text>
      {(['lockedStep1', 'lockedStep2', 'lockedStep3'] as const).map((step, index) => (
        <Text key={step} style={{ color: colors.text }}>{`${index + 1}. ${t(`delivery.code.${step}`)}`}</Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  title: { fontSize: 20, fontWeight: '700' },
  locked: { borderWidth: 1, padding: 16, gap: 8 },
})
