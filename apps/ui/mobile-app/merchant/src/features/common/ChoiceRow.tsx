import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme'

type Props = { label: string; sub?: string; selected: boolean; onPress: () => void; disabled?: boolean }

// One of a few exclusive choices as a radio row, 56 tall like a sheet's (shell/BottomSheet.tsx).
export function ChoiceRow({ label, sub, selected, onPress, disabled = false }: Props) {
  const { colors, radii } = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.choice, { borderColor: selected ? colors.focus : colors.fieldBorder, borderWidth: selected ? 2 : 1, borderRadius: radii.button, backgroundColor: colors.surface, opacity: disabled ? 0.6 : 1 }]}
    >
      <View style={[styles.dot, { borderColor: selected ? colors.focus : colors.muted, borderWidth: selected ? 5 : 1.5 }]} />
      <View style={styles.text}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        {sub ? <Text style={[styles.sub, { color: colors.muted }]}>{sub}</Text> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 56 },
  dot: { width: 20, height: 20, borderRadius: 10 },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontWeight: '700' },
  sub: { fontSize: 12 },
})
