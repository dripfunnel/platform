import { Pressable, StyleSheet, Text } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

type Props = { label: string; onPress: () => void; selected?: boolean; disabled?: boolean; hint?: string | undefined; dashed?: boolean; accessibilityLabel?: string }

// A pill the size of a finger (44 tall): a value in a rule, a value of a filter, an idea to start from. `selected` is the
// ticked state of a rule's value.
export function Chip({ label, onPress, selected = false, disabled = false, hint, dashed = false, accessibilityLabel }: Props) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (hint ? `${label} ${hint}` : label)}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? colors.focus : dashed ? colors.infoBorder : colors.fieldBorder, borderStyle: dashed ? 'dashed' : 'solid', backgroundColor: selected ? colors.infoSurface : colors.surface, opacity: disabled ? 0.6 : 1 }]}
    >
      <Text style={[styles.label, { color: selected || dashed ? colors.info : colors.textStrong }]}>{selected ? `✓ ${label}` : label}</Text>
      {hint ? <Text style={[styles.hint, { color: colors.muted }]}>{hint}</Text> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: { minHeight: 44, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 22 },
  label: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12 },
})
