import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import type { Sender } from './cartText'

const steps = ['leave', 'remind', 'recover'] as const

// A store that has had no abandoned cart yet: how it works, and a way to set up reminders for a seat that can.
export function CartsFirstRun({ sender, onSetUp }: { sender: Sender; onSetUp: (() => void) | null }) {
  const { colors, radii } = useTheme()
  return (
    <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('carts.first.title')}
      </Text>
      <Text style={[styles.body, { color: colors.muted }]}>{t('carts.first.body', { then: t(sender === 'schedule' ? 'carts.first.auto' : 'carts.first.manual') })}</Text>
      {steps.map((step, index) => (
        <View key={step} style={styles.step}>
          <Text style={[styles.n, { backgroundColor: colors.heading, color: colors.surface }]}>{index + 1}</Text>
          <View style={styles.text}>
            <Text style={[styles.stepTitle, { color: colors.text }]}>{t(`carts.first.how.${step}.title`)}</Text>
            <Text style={[styles.body, { color: colors.muted }]}>{t(`carts.first.how.${step}.body`)}</Text>
          </View>
        </View>
      ))}
      {onSetUp ? <Button label={t('carts.first.setUp')} onPress={onSetUp} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, padding: 24, gap: 14 },
  title: { fontSize: 20, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 21 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  n: { width: 28, height: 28, borderRadius: 14, textAlign: 'center', lineHeight: 28, fontSize: 13, fontWeight: '800', overflow: 'hidden' },
  text: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 14, fontWeight: '700' },
})
