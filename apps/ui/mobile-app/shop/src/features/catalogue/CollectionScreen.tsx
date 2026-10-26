import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { productsOperation, type Facet, type ProductSort } from '../../api/catalogue'
import { t } from '../../messages'
import { FilterSheet, SortSheet, sorts } from './FilterSheet'
import { ProductCardView, cardGap, screenPadding } from './ProductCardView'
import { ShowMore } from './ProductGrid'
import { OfflineBanner, ScreenHeader, Skeleton, StateMessage } from '../common/ui'
import { usePaged } from './usePaged'
import { errorKey } from '../common/errors'

const labelOf = (facets: Facet[], id: string): string | null => {
  for (const facet of facets) {
    const value = facet.values.find((v) => v.id === id)
    if (value) return `${facet.name}: ${value.name}`
  }
  return null
}

function Pill({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.pill, { borderColor: colors.fieldBorder, backgroundColor: colors.surface }]}>
      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
    </Pressable>
  )
}

// A collection, or with no slug everything the store sells: its products with the store's filters and sort, a page at a time.
export function CollectionScreen({ slug }: { slug: string | null }) {
  const router = useRouter()
  const { colors } = useTheme()
  const [filters, setFilters] = useState<string[]>([])
  const [sort, setSort] = useState<ProductSort | null>(null)
  const [sheet, setSheet] = useState<'filters' | 'sort' | null>(null)
  const [facets, setFacets] = useState<Facet[]>([])
  const [name, setName] = useState<string | null>(null)
  const request = { collection: slug, filters, sort }
  const { state, retry, more, showMore } = usePaged(productsOperation({ ...request, after: null }), (after) => productsOperation({ ...request, after }))

  const loadedFacets = state.status === 'ready' ? state.data.facets : null
  const loadedName = state.status === 'ready' ? (state.data.collection?.name ?? null) : null
  // The filters stay on screen while a new choice loads, so the sheet and the chips never flicker away.
  useEffect(() => {
    if (loadedFacets && loadedFacets.length > 0) setFacets(loadedFacets)
  }, [loadedFacets])
  useEffect(() => {
    if (loadedName) setName(loadedName)
  }, [loadedName])

  const title = slug === null ? t('collection.all') : (name ?? '')
  const sortLabel = t('collection.sort', { sort: t(sorts.find((s) => s.value === sort)?.label ?? 'collection.sorts.featured') })
  const description = state.status === 'ready' ? state.data.collection?.description : null
  const missing = state.status === 'ready' && slug !== null && state.data.collection === null

  const empty = () => {
    if (state.status === 'loading') return <Skeleton kind="grid" />
    if (state.status === 'error') return <StateMessage title={t('states.error.title')} body={t(errorKey(state.code))} actionLabel={t('states.retry')} onAction={retry} />
    if (state.status === 'offline') return <StateMessage title={t('states.offline.title')} body={t('states.offline.body')} actionLabel={t('states.retry')} onAction={retry} />
    if (missing) return <StateMessage title={t('collection.notFound.title')} body={t('collection.notFound.body')} />
    if (filters.length > 0) return <StateMessage title={t('collection.none.title')} body={t('collection.none.body')} actionLabel={t('collection.clearFilters')} onAction={() => setFilters([])} />
    return <StateMessage title={t('collection.empty.title')} body={t('collection.empty.body')} />
  }

  const header = (
    <View style={styles.head}>
      {state.status === 'ready' && state.stale ? <OfflineBanner /> : null}
      {description ? <Text style={{ color: colors.muted, fontSize: 14 }}>{description}</Text> : null}
      <View style={styles.controls}>
        {facets.length > 0 ? <Pill label={filters.length > 0 ? t('collection.filtersCount', { count: filters.length }) : t('collection.filters')} onPress={() => setSheet('filters')} /> : null}
        <Pill label={sortLabel} onPress={() => setSheet('sort')} />
      </View>
      {filters.length > 0 ? (
        <View style={styles.chips}>
          {filters.map((id) => {
            const label = labelOf(facets, id)
            return label ? <Pill key={id} label={t('collection.removeFilter', { label })} onPress={() => setFilters(filters.filter((f) => f !== id))} /> : null
          })}
          <Pressable accessibilityRole="button" onPress={() => setFilters([])} style={styles.clear}>
            <Text style={{ color: colors.link, fontWeight: '700' }}>{t('collection.clearAll')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={title} onBack={() => (router.canGoBack() ? router.back() : router.replace('/browse'))} />
      <FlatList
        data={state.status === 'ready' && !missing ? state.data.items : []}
        keyExtractor={(product) => product.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        renderItem={({ item }) => <ProductCardView product={item} onOpen={(productSlug) => router.push(`/product/${productSlug}`)} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={state.status === 'ready' ? <ShowMore next={state.data.next} more={more} onPress={showMore} /> : null}
        contentContainerStyle={styles.list}
      />
      {sheet === 'filters' ? (
        <FilterSheet
          facets={facets}
          selected={filters}
          onApply={(chosen) => {
            setFilters(chosen)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'sort' ? (
        <SortSheet
          selected={sort}
          onPick={(value) => {
            setSort(value)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingBottom: 32, rowGap: 18 },
  row: { columnGap: cardGap, paddingHorizontal: screenPadding },
  head: { gap: 12, paddingBottom: 16, paddingHorizontal: screenPadding, paddingTop: 12 },
  controls: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  pill: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderRadius: 22 },
  clear: { minHeight: 44, justifyContent: 'center' },
})
