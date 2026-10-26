import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { homeOperation, type Collection } from '../../api/catalogue'
import { BrandMark } from '../../brand/BrandMark'
import { t } from '../../messages'
import { ProductGrid } from './ProductGrid'
import { screenPadding } from './ProductCardView'
import { SearchEntry } from './SearchEntry'
import { Resource, StateMessage } from '../common/ui'
import { useOperation } from '../common/useOperation'

export function CollectionTile({ collection, onOpen }: { collection: Collection; onOpen: (slug: string) => void }) {
  const { colors, radii } = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={collection.name} onPress={() => onOpen(collection.slug)} style={styles.tile}>
      <View style={[styles.tileImage, { backgroundColor: colors.skeleton, borderRadius: radii.tile }]}>
        {collection.imageUrl ? <Image source={{ uri: collection.imageUrl }} accessibilityIgnoresInvertColors contentFit="cover" style={StyleSheet.absoluteFill} /> : null}
      </View>
      <Text numberOfLines={2} style={[styles.tileName, { color: colors.text }]}>
        {collection.name}
      </Text>
    </Pressable>
  )
}

export function HomeScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const { state, retry } = useOperation(homeOperation())
  const openProduct = (slug: string) => router.push(`/product/${slug}`)
  const openCollection = (slug: string) => router.push(`/browse/collection/${slug}`)

  return (
    <ScrollView style={{ backgroundColor: colors.page }} contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <BrandMark />
      <SearchEntry onPress={() => router.push('/browse/search')} />
      <Resource state={state} onRetry={retry} skeleton="grid">
        {(home) =>
          home.collections.length === 0 && home.products.length === 0 ? (
            <StateMessage title={t('home.empty.title')} body={t('home.empty.body')} />
          ) : (
            <>
              {home.collections.length > 0 ? (
                <View style={styles.section}>
                  <Text accessibilityRole="header" style={[styles.heading, { color: colors.heading }]}>
                    {t('home.collections')}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
                    {home.collections.map((collection) => (
                      <CollectionTile key={collection.id} collection={collection} onOpen={openCollection} />
                    ))}
                  </ScrollView>
                </View>
              ) : null}
              {home.products.length > 0 ? (
                <View style={styles.section}>
                  <View style={styles.sectionHead}>
                    <Text accessibilityRole="header" style={[styles.heading, { color: colors.heading }]}>
                      {t('home.newIn')}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('home.seeAllNewIn')} onPress={() => router.push('/browse/all')} style={styles.seeAll}>
                      <Text style={{ color: colors.link, fontWeight: '700' }}>{t('home.seeAll')}</Text>
                    </Pressable>
                  </View>
                  <ProductGrid products={home.products} onOpen={openProduct} />
                </View>
              ) : null}
            </>
          )
        }
      </Resource>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { gap: 20, paddingBottom: 32 },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: screenPadding },
  heading: { fontSize: 20, fontWeight: '700', paddingHorizontal: screenPadding },
  seeAll: { minHeight: 44, justifyContent: 'center' },
  tiles: { gap: 10, paddingHorizontal: screenPadding },
  tile: { width: 120, gap: 6 },
  tileImage: { width: 120, height: 120, overflow: 'hidden' },
  tileName: { fontSize: 14, fontWeight: '700' },
})
