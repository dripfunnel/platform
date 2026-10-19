import { StyleSheet, Text } from 'react-native'
import { useTheme } from '../../theme'

// The small capitals over a group of cards ("Needs you", "Latest orders"), as the prototype's mono caption.
export function Eyebrow({ text }: { text: string }) {
  const { colors } = useTheme()
  return (
    <Text accessibilityRole="header" style={[styles.text, { color: colors.muted }]}>
      {text}
    </Text>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', paddingLeft: 4 },
})
