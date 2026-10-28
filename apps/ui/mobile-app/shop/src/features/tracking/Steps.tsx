import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'
import type { TrackingStep } from './tracking'

/** The delivery's steps with their times; each says where it stands in words, so none is told apart by its colour alone. */
export function Steps({ steps }: { steps: TrackingStep[] }) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="list" style={styles.list}>
      <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 16, fontWeight: '800' }}>
        {t('tracking.stepsTitle')}
      </Text>
      {steps.map((step) => {
        const filled = step.progress !== 'todo'
        const dot = step.stopped ? colors.danger : filled ? colors.brand : colors.border
        return (
          <View key={step.state} accessible accessibilityLabel={[step.label, step.progressLabel, step.at].filter(Boolean).join(', ')} style={styles.step}>
            <View style={[styles.dot, { backgroundColor: step.progress === 'done' || step.stopped ? dot : colors.page, borderColor: dot }]} />
            <View style={styles.text}>
              <Text style={{ color: step.progress === 'todo' ? colors.muted : colors.heading, fontSize: 15, fontWeight: step.progress === 'current' ? '800' : '600' }}>{step.label}</Text>
              <Text style={{ color: step.stopped ? colors.danger : colors.muted, fontSize: 13 }}>{[step.progressLabel, step.at].filter(Boolean).join(' · ')}</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  step: { flexDirection: 'row', gap: 12, minHeight: 44, alignItems: 'flex-start' },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, marginTop: 3 },
  text: { flex: 1, gap: 1 },
})
