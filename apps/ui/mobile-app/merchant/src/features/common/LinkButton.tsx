import { Pressable, StyleSheet, Text } from 'react-native'
import { useTheme } from '../../theme'

type Props = { label: string; onPress: () => void; danger?: boolean; disabled?: boolean; accessibilityLabel?: string }

// A text action with a 44 px hit target (DESIGN.md §4).
export function LinkButton({ label, onPress, danger = false, disabled = false, accessibilityLabel }: Props) {
  const { colors } = useTheme()
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={8} style={[styles.link, { opacity: disabled ? 0.5 : 1 }]}>
      <Text style={[styles.label, { color: danger ? colors.danger : colors.link }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  label: { fontSize: 14, fontWeight: '700' },
})
