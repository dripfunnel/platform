import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme'
import { toneColours } from '../products/productView'
import type { PillTone } from './cartText'

// A cart's reminder status: its word, in the tone's colours. The `info` tone is the one the product chips don't have.
export function CartPill({ label, tone }: { label: string; tone: PillTone }) {
  const { colors } = useTheme()
  const palette = tone === 'info' ? { fg: colors.info, bg: colors.infoSurface, border: colors.infoBorder } : toneColours(colors, tone)
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', minHeight: 24, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 12, borderWidth: 1 },
  label: { fontSize: 12, fontWeight: '700' },
})
