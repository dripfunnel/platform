import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { productSorts, type ProductCounts, type ProductFilter, type ProductSort } from '../../api/products'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { useTheme } from '../../theme'
import { useFeedback } from '../shell/Feedback'
import { chipsOf } from './productView'

type Props = {
  search: string
  onSearch: (search: string) => void
  filter: ProductFilter
  onFilter: (filter: ProductFilter) => void
  sort: ProductSort
  onSort: (sort: ProductSort) => void
  counts: ProductCounts | null
}

// Search, the sort choice and the filter chips (CATALOG-DESIGN.md B2–B4). Each chip says how many the API counted.
export function ProductsFilters({ search, onSearch, filter, onFilter, sort, onSort, counts }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()

  const chooseSort = () =>
    feedback.menu({
      title: t('products.sort.label'),
      items: productSorts.map((key) => ({ key, label: `${key === sort ? '✓ ' : ''}${t(`products.sort.${key}`)}`, onPress: () => onSort(key) })),
    })

  return (
    <View style={styles.block}>
      <View style={styles.searchRow}>
        <View style={[styles.search, { borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}>
          <TextInput
            accessibilityLabel={t('products.search.label')}
            value={search}
            onChangeText={onSearch}
            placeholder={t('products.search.placeholder')}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.input, { color: colors.text }]}
          />
          {search ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('products.search.clear')} onPress={() => onSearch('')} style={styles.clear}>
              <Text style={{ color: colors.muted, fontSize: 18 }}>×</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('products.sort.label')}: ${t(`products.sort.${sort}`)}`} onPress={chooseSort} style={[styles.sort, { borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}>
          <Text style={[styles.sortText, { color: colors.textStrong }]}>{t('products.sort.label')}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t('products.chips.label')}>
        {chipsOf(counts, filter).map((chip) => {
          const on = chip.key === filter
          return (
            <Pressable
              key={chip.key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => onFilter(chip.key)}
              style={[styles.chip, { borderColor: on ? colors.focus : colors.fieldBorder, backgroundColor: on ? colors.infoSurface : colors.surface }]}
            >
              <Text style={[styles.chipLabel, { color: on ? colors.info : colors.textStrong }]}>{t(`products.chips.${chip.key}`)}</Text>
              {chip.count !== null ? <Text style={[styles.chipCount, { color: on ? colors.info : colors.textStrong }]}>{formatNumber(chip.count, locale)}</Text> : null}
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingLeft: 12 },
  input: { flex: 1, fontSize: 15, minHeight: 44 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sort: { minHeight: 44, minWidth: 64, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  sortText: { fontSize: 14, fontWeight: '600' },
  chips: { gap: 6, paddingRight: 8 },
  chip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1 },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  chipCount: { fontSize: 13, opacity: 0.75 },
})
