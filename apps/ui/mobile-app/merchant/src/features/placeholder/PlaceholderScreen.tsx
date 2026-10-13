import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '../../theme'

export function PlaceholderScreen({ title, children }: { title: string; children?: ReactNode }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      {children}
      <Text style={[styles.title, { color: colors.heading }]}>{title}</Text>
      <Text style={{ color: colors.text }}>{t('placeholder.body')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: '700' },
})
