import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

/** One option of a group of radio choices: a 44 px target that is read with its name, price and note. */
export function Choice({ selected, disabled = false, label, note, price, onPress, children }: { selected: boolean; disabled?: boolean; label: string; note?: string | null; price?: string; onPress: () => void; children?: ReactNode }) {
  const { colors, radii } = useTheme()
  return (
    <View style={[styles.box, { borderRadius: radii.card, borderColor: selected ? colors.focus : colors.border, backgroundColor: selected ? colors.selected : colors.surface, opacity: disabled ? 0.6 : 1 }]}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: selected, disabled }}
        accessibilityLabel={[label, price, note].filter(Boolean).join(', ')}
        disabled={disabled}
        onPress={onPress}
        style={styles.row}
      >
        <View style={[styles.dot, { borderColor: selected ? colors.focus : colors.fieldBorder }]}>{selected ? <View style={[styles.dotFill, { backgroundColor: colors.focus }]} /> : null}</View>
        <View style={styles.text}>
          <View style={styles.head}>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 }}>{label}</Text>
            {price ? <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{price}</Text> : null}
          </View>
          {note ? <Text style={{ color: colors.muted, fontSize: 13 }}>{note}</Text> : null}
        </View>
      </Pressable>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, minHeight: 56 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  dotFill: { width: 10, height: 10, borderRadius: 5 },
  text: { flex: 1, gap: 3 },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
})
