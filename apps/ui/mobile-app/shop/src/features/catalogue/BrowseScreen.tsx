import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { collectionsOperation } from '../../api/catalogue'
import { t } from '../../messages'
import { ShowMore } from './ProductGrid'
import { screenPadding } from './ProductCardView'
import { SearchEntry } from './SearchEntry'
import { Resource, StateMessage } from '../common/ui'
import { usePaged } from './usePaged'

function Row({ title, body, imageUrl, onPress }: { title: string; body: string | null; imageUrl: string | null; onPress: () => void }) {
  const { colors, radii } = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.card }]}>
      <View style={[styles.rowImage, { backgroundColor: colors.skeleton, borderRadius: radii.button }]}>
        {imageUrl ? <Image source={{ uri: imageUrl }} accessibilityIgnoresInvertColors contentFit="cover" style={StyleSheet.absoluteFill} /> : null}
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.text }]}>{title}</Text>
        {body ? (
          <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 13 }}>
            {body}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

// The Browse tab: everything the store sells, and its collections.
export function BrowseScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const { state, retry, more, showMore } = usePaged(collectionsOperation(null), collectionsOperation)

  return (
    <ScrollView style={{ backgroundColor: colors.page }} contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('browse.title')}
      </Text>
      <SearchEntry onPress={() => router.push('/browse/search')} />
      <View style={styles.list}>
        <Row title={t('browse.all')} body={t('browse.allBody')} imageUrl={null} onPress={() => router.push('/browse/all')} />
        <Resource state={state} onRetry={retry} skeleton="list">
          {(page) =>
            page.items.length === 0 ? (
              <StateMessage title={t('browse.empty.title')} body={t('browse.empty.body')} />
            ) : (
              <>
                {page.items.map((collection) => (
                  <Row key={collection.id} title={collection.name} body={collection.description} imageUrl={collection.imageUrl} onPress={() => router.push(`/browse/collection/${collection.slug}`)} />
                ))}
                <ShowMore next={page.next} more={more} onPress={showMore} />
              </>
            )
          }
        </Resource>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { gap: 16, paddingBottom: 32 },
  title: { fontSize: 26, fontWeight: '700', paddingHorizontal: screenPadding },
  list: { gap: 10, paddingHorizontal: screenPadding },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderWidth: 1, minHeight: 72 },
  rowImage: { width: 56, height: 56, overflow: 'hidden' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '700' },
})
