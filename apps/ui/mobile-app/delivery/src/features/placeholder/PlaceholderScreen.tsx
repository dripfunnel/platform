import { StyleSheet, Text, View } from 'react-native'
import { BrandMark } from '../../brand/BrandMark'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

// Every tab has a screen until its own card builds it (DL 12–DL 14).
export function PlaceholderScreen({ title }: { title: string }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <BrandMark />
      <Text style={[styles.title, { color: colors.heading }]}>{title}</Text>
      <Text style={{ color: colors.text }}>{t('placeholder.body')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { fontSize: 20, fontWeight: '700' },
})
