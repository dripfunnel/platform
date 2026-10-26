import { Pressable, StyleSheet, Text } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'
import { screenPadding } from './ProductCardView'

/** The search box as a button: it opens the search screen, where typing happens. */
export function SearchEntry({ onPress }: { onPress: () => void }) {
  const { colors, radii } = useTheme()
  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel={t('home.search')}
      onPress={onPress}
      style={[styles.entry, { borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}
    >
      <Text style={{ color: colors.muted, fontSize: 15 }}>{t('home.search')}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  entry: { minHeight: 48, justifyContent: 'center', borderWidth: 1, marginHorizontal: screenPadding, paddingHorizontal: 14 },
})
