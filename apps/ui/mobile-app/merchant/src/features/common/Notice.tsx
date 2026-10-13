import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme'

// An error or an explanation above a form. Errors are announced to a screen reader as they appear.
export function Notice({ text, kind = 'info' }: { text: string; kind?: 'info' | 'error' | 'success' }) {
  const { colors, radii } = useTheme()
  const palette = {
    info: { bg: colors.infoSurface, border: colors.infoBorder, fg: colors.info },
    error: { bg: colors.dangerSurface, border: colors.dangerBorder, fg: colors.danger },
    success: { bg: colors.successSurface, border: colors.successBorder, fg: colors.success },
  }[kind]
  return (
    <View accessibilityRole={kind === 'error' ? 'alert' : undefined} accessibilityLiveRegion={kind === 'error' ? 'assertive' : 'polite'} style={[styles.box, { backgroundColor: palette.bg, borderColor: palette.border, borderRadius: radii.button }]}>
      <Text style={[styles.text, { color: palette.fg }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  text: { fontSize: 14, lineHeight: 21 },
})
