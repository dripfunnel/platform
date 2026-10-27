import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { collectionsOperation, searchOperation, type ProductCard } from '../../api/catalogue'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { priceLabel, screenPadding } from './ProductCardView'
import { ProductGrid, ShowMore } from './ProductGrid'
import { addRecentSearch, clearRecentSearches, readRecentSearches } from './recentSearches'
import { OfflineBanner, Skeleton, StateMessage } from '../common/ui'
import { searchDebounceMs, useDebounced } from './useDebounced'
import { useOperation } from '../common/useOperation'
import { usePaged } from './usePaged'
import { errorKey } from '../common/errors'

const suggestionCount = 5

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.chip, { borderColor: colors.fieldBorder, backgroundColor: colors.surface }]}>
      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
    </Pressable>
  )
}

function Suggestion({ product, onOpen }: { product: ProductCard; onOpen: () => void }) {
  const { colors } = useTheme()
  const price = priceLabel(product)
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={[product.name, price].filter(Boolean).join(', ')} onPress={onOpen} style={[styles.suggestion, { borderColor: colors.border }]}>
      <View style={[styles.thumb, { backgroundColor: colors.skeleton }]}>{product.photo ? <Image source={{ uri: product.photo.url }} accessibilityIgnoresInvertColors contentFit="cover" style={StyleSheet.absoluteFill} /> : null}</View>
      <View style={styles.suggestionText}>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>{product.name}</Text>
        {price ? <Text style={{ color: colors.muted, fontSize: 13 }}>{price}</Text> : null}
      </View>
    </Pressable>
  )
}

// As-you-type search: suggestions once the typing pauses, full results on Search, and recent searches kept on this phone only.
export function SearchScreen() {
  const router = useRouter()
  const { host } = useShop()
  const { colors, radii } = useTheme()
  const insets = useSafeAreaInsets()
  const [text, setText] = useState('')
  const [committed, setCommitted] = useState<string | null>(null)
  const [recents, setRecents] = useState<string[]>([])
  const typed = text.trim()
  const settled = useDebounced(typed, searchDebounceMs)

  useEffect(() => {
    void readRecentSearches(host).then(setRecents)
  }, [host])

  const suggesting = committed === null && typed !== ''
  const suggestions = useOperation(suggesting && settled !== '' ? searchOperation(settled, null, suggestionCount) : null)
  const results = usePaged(committed !== null ? searchOperation(committed, null) : null, (after) => searchOperation(committed ?? '', after))
  const collections = useOperation(collectionsOperation(null))

  const remember = (query: string) => void addRecentSearch(host, query).then(setRecents)
  const search = (query: string) => {
    const words = query.trim()
    if (words === '') return
    setText(words)
    setCommitted(words)
    remember(words)
  }
  const openProduct = (slug: string) => router.push(`/product/${slug}`)

  const collectionChips =
    collections.state.status === 'ready' && collections.state.data.items.length > 0 ? (
      <View style={styles.block}>
        <Text accessibilityRole="header" style={[styles.label, { color: colors.muted }]}>
          {t('search.browseCollections')}
        </Text>
        <View style={styles.chips}>
          {collections.state.data.items.map((collection) => (
            <Chip key={collection.id} label={collection.name} onPress={() => router.push(`/browse/collection/${collection.slug}`)} />
          ))}
        </View>
      </View>
    ) : null

  const body = () => {
    if (typed === '') {
      return (
        <>
          {recents.length > 0 ? (
            <View style={styles.block}>
              <View style={styles.recentHead}>
                <Text accessibilityRole="header" style={[styles.label, { color: colors.muted }]}>
                  {t('search.recent')}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void clearRecentSearches(host)
                    setRecents([])
                  }}
                  style={styles.clearRecent}
                >
                  <Text style={{ color: colors.link, fontWeight: '700' }}>{t('search.clearRecent')}</Text>
                </Pressable>
              </View>
              {recents.map((query) => (
                <Pressable key={query} accessibilityRole="button" accessibilityLabel={query} onPress={() => search(query)} style={styles.recent}>
                  <Text style={{ color: colors.text, fontSize: 16 }}>{query}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {collectionChips}
        </>
      )
    }
    if (committed === null) {
      const { state } = suggestions
      return (
        <View style={[styles.suggestions, { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.card }]}>
          {settled !== typed || state.status === 'loading' ? <Skeleton kind="list" /> : null}
          {settled === typed && state.status === 'error' ? <StateMessage title={t('states.error.title')} body={t(errorKey(state.code))} /> : null}
          {settled === typed && state.status === 'offline' ? <StateMessage title={t('states.offline.title')} body={t('states.offline.body')} /> : null}
          {settled === typed && state.status === 'ready' ? (
            <>
              {state.data.items.map((product) => (
                <Suggestion
                  key={product.id}
                  product={product}
                  onOpen={() => {
                    remember(typed)
                    openProduct(product.slug)
                  }}
                />
              ))}
              {state.data.items.length === 0 ? <Text style={[styles.none, { color: colors.muted }]}>{t('search.noSuggestions')}</Text> : null}
            </>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => search(typed)} style={styles.all}>
            <Text style={{ color: colors.link, fontWeight: '700', fontSize: 15 }}>{t('search.seeResults', { query: typed })}</Text>
          </Pressable>
        </View>
      )
    }
    const { state } = results
    if (state.status === 'loading') return <Skeleton kind="grid" />
    if (state.status === 'error') return <StateMessage title={t('states.error.title')} body={t(errorKey(state.code))} actionLabel={t('states.retry')} onAction={results.retry} />
    if (state.status === 'offline') return <StateMessage title={t('states.offline.title')} body={t('states.offline.body')} actionLabel={t('states.retry')} onAction={results.retry} />
    if (state.data.items.length === 0) {
      return (
        <View style={styles.block}>
          <StateMessage title={t('search.none.title', { query: committed })} body={t('search.none.body')} />
          {collectionChips}
        </View>
      )
    }
    return (
      <>
        {state.stale ? <OfflineBanner /> : null}
        <ProductGrid products={state.data.items} onOpen={openProduct} />
        <ShowMore next={state.data.next} more={results.more} onPress={results.showMore} />
      </>
    )
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <View style={[styles.bar, { paddingTop: insets.top + 8, borderColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/browse'))} style={styles.back}>
          <Text style={[styles.backGlyph, { color: colors.heading }]}>‹</Text>
        </Pressable>
        <TextInput
          accessibilityLabel={t('search.label')}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          placeholder={t('home.search')}
          placeholderTextColor={colors.muted}
          value={text}
          onChangeText={(value) => {
            setText(value)
            setCommitted(null)
          }}
          onSubmitEditing={() => search(typed)}
          style={[styles.input, { borderColor: colors.fieldBorder, backgroundColor: colors.surface, color: colors.text, borderRadius: radii.button }]}
        />
        {text !== '' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('search.clear')}
            onPress={() => {
              setText('')
              setCommitted(null)
            }}
            style={styles.back}
          >
            <Text style={{ color: colors.muted, fontSize: 22 }}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {body()}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 8, paddingRight: 4, borderBottomWidth: 1 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { fontSize: 32, lineHeight: 36 },
  input: { flex: 1, minHeight: 44, borderWidth: 1, paddingHorizontal: 12, fontSize: 16 },
  body: { gap: 16, paddingVertical: 16, paddingBottom: 32 },
  block: { gap: 10, paddingHorizontal: screenPadding },
  label: { fontSize: 13, fontWeight: '700' },
  recentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clearRecent: { minHeight: 44, justifyContent: 'center' },
  recent: { minHeight: 44, justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderRadius: 22 },
  suggestions: { marginHorizontal: screenPadding, borderWidth: 1, overflow: 'hidden' },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, padding: 10, borderBottomWidth: 1 },
  thumb: { width: 44, height: 54, borderRadius: 6, overflow: 'hidden' },
  suggestionText: { flex: 1, gap: 2 },
  none: { padding: 14, fontSize: 14 },
  all: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14 },
})
