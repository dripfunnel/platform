import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme'

type Props = { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }

// A labelled on/off row, 44 tall like every control (DESIGN.md §4), drawn as the prototype's 38 x 22 switch.
export function Switch({ label, value, onChange, disabled = false }: Props) {
  const { colors } = useTheme()
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => onChange(!value)} style={[styles.row, { opacity: disabled ? 0.6 : 1 }]}>
      <View style={[styles.track, { backgroundColor: value ? colors.success : colors.fieldBorder }]}>
        <View style={[styles.knob, { left: value ? 19 : 3, backgroundColor: colors.surface }]} />
      </View>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { width: 38, height: 22, borderRadius: 11 },
  knob: { position: 'absolute', top: 3, width: 16, height: 16, borderRadius: 8 },
  label: { flex: 1, fontSize: 14, lineHeight: 20 },
})
