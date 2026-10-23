import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { toneColours, type Tone } from '../productView'

export type BannerSpec = { key: string; tone: Tone | 'info'; title: string; body?: string; action?: { label: string; onPress: () => void } }

// A note above the form: what is true of this product for this seat, or why a save was refused. Errors are announced.
export function EditorBanner({ spec }: { spec: BannerSpec }) {
  const { colors, radii } = useTheme()
  const palette = spec.tone === 'info' ? { fg: colors.info, bg: colors.infoSurface, border: colors.infoBorder } : toneColours(colors, spec.tone)
  return (
    <View accessibilityRole={spec.tone === 'danger' ? 'alert' : undefined} style={[styles.box, { backgroundColor: palette.bg, borderColor: palette.border, borderRadius: radii.button }]}>
      <Text style={[styles.text, { color: palette.fg }]}>
        <Text style={styles.title}>{spec.title}</Text>
        {spec.body ? ` ${spec.body}` : ''}
      </Text>
      {spec.action ? (
        <Pressable accessibilityRole="button" onPress={spec.action.onPress} style={[styles.action, { borderColor: palette.border, backgroundColor: colors.surface }]}>
          <Text style={{ color: palette.fg, fontWeight: '700', fontSize: 13 }}>{spec.action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { padding: 12, gap: 10, borderWidth: 1 },
  text: { fontSize: 14, lineHeight: 20 },
  title: { fontWeight: '700' },
  action: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
})
