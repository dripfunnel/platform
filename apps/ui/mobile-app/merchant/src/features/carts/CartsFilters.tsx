import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { cartTabs, type CartCounts, type CartTab } from '../../api/carts'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Chip } from '../common/Chip'

type Props = { tab: CartTab; onTab: (tab: CartTab) => void; counts: CartCounts | null; search: string; onSearch: (search: string) => void }

// In progress, Recovered and Not recovered with the API's counts, and a search by name, email or product (FIRST-RELEASE (store) §9).
export function CartsFilters({ tab, onTab, counts, search, onSearch }: Props) {
  const { colors, radii } = useTheme()
  return (
    <View style={styles.block}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t('carts.tabs.label')}>
        {cartTabs.map((key) => (
          <Chip
            key={key}
            label={t(`carts.tabs.${key}`)}
            {...(counts ? { hint: formatNumber(counts[key], locale) } : {})}
            accessibilityLabel={counts ? `${t(`carts.tabs.${key}`)}, ${formatNumber(counts[key], locale)}` : t(`carts.tabs.${key}`)}
            selected={tab === key}
            onPress={() => onTab(key)}
          />
        ))}
      </ScrollView>
      <View style={[styles.search, { borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}>
        <TextInput
          accessibilityLabel={t('carts.search.label')}
          value={search}
          onChangeText={onSearch}
          placeholder={t('carts.search.placeholder')}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: colors.text }]}
        />
        {search ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('carts.search.clear')} onPress={() => onSearch('')} style={styles.clear}>
            <Text style={{ color: colors.muted, fontSize: 18 }}>×</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  chips: { gap: 6, paddingRight: 8 },
  search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingLeft: 12 },
  input: { flex: 1, fontSize: 15, minHeight: 44 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
})
