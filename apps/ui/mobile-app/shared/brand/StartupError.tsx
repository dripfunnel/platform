import { Pressable, StyleSheet, Text, View } from 'react-native'
import { buildTheme, useMode } from '../theme'

// Drawn before any provider has a theme, so it takes DripFunnel's own palette in the app's mode. The cause stays out of the screen.
export function StartupError({ title, retryLabel, onRetry }: { title: string; retryLabel: string; onRetry: () => void }) {
  const { colors } = buildTheme(useMode())
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <Text style={[styles.title, { color: colors.heading }]}>{title}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={[styles.button, { backgroundColor: colors.brand }]}>
        <Text style={[styles.label, { color: colors.brandContrast }]}>{retryLabel}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  button: { minHeight: 44, minWidth: 120, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingHorizontal: 16 },
  label: { fontWeight: '700' },
})
