import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useOnline } from '../shell/connection'

type Props = { label: string; onPress: () => void; kind?: 'primary' | 'secondary'; busy?: boolean; disabled?: boolean; saves?: boolean }

// 50 px tall, full width: a hit target of 44 px or more (DESIGN.md §4). The brand colour carries dark text (SAAS.md §3.3).
// `saves` marks a button that writes: it is off while the phone has no connection (FIRST-RELEASE.md §3.3).
export function Button({ label, onPress, kind = 'primary', busy = false, disabled = false, saves = false }: Props) {
  const { colors, radii } = useTheme()
  const primary = kind === 'primary'
  const online = useOnline()
  const inactive = busy || disabled || (saves && !online)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { borderRadius: radii.button, backgroundColor: primary ? (pressed ? colors.brandHover : colors.brand) : colors.surface, borderColor: primary ? colors.brand : colors.fieldBorder, opacity: inactive && !busy ? 0.5 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? colors.brandContrast : colors.text} /> : <Text style={[styles.label, { color: primary ? colors.brandContrast : colors.text }]}>{label}</Text>}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: { height: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, paddingHorizontal: 16 },
  label: { fontSize: 16, fontWeight: '700' },
})
