import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme'
import { toneColours, type Tone } from './productView'

// A small pill: Visible, Hidden, Waiting for approval, Sent back (CATALOG-DESIGN.md B1), or a tone for another short fact.
export function StatusChip({ label, tone }: { label: string; tone: Tone }) {
  const { colors } = useTheme()
  const palette = toneColours(colors, tone)
  return (
    <View style={[styles.chip, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', minHeight: 24, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 12, borderWidth: 1 },
  label: { fontSize: 12, fontWeight: '600' },
})
