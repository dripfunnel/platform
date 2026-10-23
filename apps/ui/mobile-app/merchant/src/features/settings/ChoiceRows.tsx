import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { ChoiceRow } from '../common/ChoiceRow'

export type Choice<V extends string> = { value: V; label: string; sub?: string }

type Props<V extends string> = { label?: string; value: V; options: readonly Choice<V>[]; onChange: (value: V) => void; disabled?: boolean }

// One of a few, each a row with what it means under it (the same rows a sheet's choices draw).
export function ChoiceRows<V extends string>({ label, value, options, onChange, disabled = false }: Props<V>) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
      {label ? <Text style={[styles.label, { color: colors.text }]}>{label}</Text> : null}
      {options.map((option) => (
        <ChoiceRow key={option.value} label={option.label} {...(option.sub ? { sub: option.sub } : {})} selected={option.value === value} disabled={disabled} onPress={() => onChange(option.value)} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
})
