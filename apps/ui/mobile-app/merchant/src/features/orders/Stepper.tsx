import { Pressable, StyleSheet, Text, View } from 'react-native'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { useTheme } from '../../theme'

type Props = { name: string; value: number; max: number; onChange: (value: number) => void; disabled?: boolean }

// "− 2 / 3 +": how many of a line, from none up to `max` (PortalOrders' ship, return and refund pickers). 44 px targets.
export function Stepper({ name, value, max, onChange, disabled = false }: Props) {
  const { colors, radii } = useTheme()
  const button = (label: string, accessibilityLabel: string, off: boolean, next: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={() => onChange(next)}
      style={[styles.button, { borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button, opacity: off ? 0.4 : 1 }]}
    >
      <Text style={[styles.glyph, { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
  return (
    <View style={styles.row}>
      {button('−', t('orders.detail.line.fewer', { name }), disabled || value <= 0, value - 1)}
      <Text accessibilityLiveRegion="polite" style={[styles.count, { color: colors.text }]}>
        {t('orders.detail.line.picked', { picked: formatNumber(value, locale), left: formatNumber(max, locale) })}
      </Text>
      {button('+', t('orders.detail.line.more', { name }), disabled || value >= max, value + 1)}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  glyph: { fontSize: 20, fontWeight: '600' },
  count: { minWidth: 52, textAlign: 'center', fontSize: 14, fontWeight: '700' },
})
