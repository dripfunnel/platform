import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme'
import { Chip } from '../common/Chip'

type Props<K extends string> = { label: string; value: K; chips: readonly { key: K; label: string; count: number }[]; onChange: (key: K) => void }

// "Show: Everyone · Staff · Waiting", each with how many it holds.
export function FilterChips<K extends string>({ label, value, chips, onChange }: Props<K>) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <View style={styles.chips}>
        {chips.map((chip) => (
          <Chip key={chip.key} label={chip.label} hint={String(chip.count)} accessibilityLabel={`${chip.label} ${chip.count}`} selected={chip.key === value} onPress={() => onChange(chip.key)} />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
