import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { orderFilters, type OrderCounts, type OrderFilter } from '../../api/orders'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { useTheme } from '../../theme'
import { Chip } from '../common/Chip'
import { countKey } from './orderView'

type Props = { search: string; onSearch: (search: string) => void; filter: OrderFilter; onFilter: (filter: OrderFilter) => void; counts: OrderCounts | null }

// Search, and the status chips, each saying how many orders the API counted for it (FIRST-RELEASE.md §6).
export function OrderFilters({ search, onSearch, filter, onFilter, counts }: Props) {
  const { colors, radii } = useTheme()
  return (
    <View style={styles.block}>
      <View style={[styles.search, { borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}>
        <TextInput
          accessibilityLabel={t('orders.search.label')}
          value={search}
          onChangeText={onSearch}
          placeholder={t('orders.search.placeholder')}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: colors.text }]}
        />
        {search ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('orders.search.clear')} onPress={() => onSearch('')} style={styles.clear}>
            <Text style={{ color: colors.muted, fontSize: 18 }}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t('orders.chips.label')}>
        {orderFilters.map((key) => {
          const count = counts ? formatNumber(counts[countKey[key]], locale) : undefined
          return <Chip key={key} label={t(`orders.chips.${key}`)} hint={count} selected={key === filter} onPress={() => onFilter(key)} />
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingLeft: 12 },
  input: { flex: 1, fontSize: 15, minHeight: 44 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 6, paddingRight: 8 },
})
