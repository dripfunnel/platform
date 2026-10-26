import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../messages'
import { buildTheme } from '@dripfunnel/mobile-shared/theme'

// Drawn before any provider has a theme, so it takes DripFunnel's own palette. The cause stays out of the screen.
export function StartupError({ onRetry }: { onRetry: () => void }) {
  const { colors } = buildTheme('light')
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <Text style={[styles.title, { color: colors.heading }]}>{t('startup.failed')}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={[styles.button, { backgroundColor: colors.brand }]}>
        <Text style={styles.label}>{t('startup.retry')}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  button: { minHeight: 44, minWidth: 120, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingHorizontal: 16 },
  label: { color: '#0a2a4a', fontWeight: '700' },
})
