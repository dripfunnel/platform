import { Image } from 'expo-image'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { ProductCard } from '../../api/catalogue'
import { t } from '../../messages'
import { money } from './words'

/** The price as a card shows it: the API's price, "From" when the versions differ, with the compare-at price struck through. */
export function priceLabel(product: Pick<ProductCard, 'price' | 'fromPrice'>): string | null {
  if (!product.price) return null
  return product.fromPrice ? t('product.from', { price: money(product.price) }) : money(product.price)
}

export const screenPadding = 16
export const cardGap = 12

/** Two cards to a row between the screen's padding. */
export const useCardWidth = (): number => (useWindowDimensions().width - 2 * screenPadding - cardGap) / 2

// `onOpen` takes the product's slug.
export function ProductCardView({ product, onOpen }: { product: ProductCard; onOpen: (slug: string) => void }) {
  const { colors, radii } = useTheme()
  const width = useCardWidth()
  const price = priceLabel(product)
  const was = product.compareAt && product.compareAt.amount !== product.price?.amount ? money(product.compareAt) : null
  const label = [product.name, price, was ? t('product.was', { price: was }) : null, product.inStock ? null : t('product.stock.soldOut')].filter(Boolean).join(', ')
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onOpen(product.slug)} style={[styles.card, { width }]}>
      <View style={[styles.photo, { backgroundColor: colors.skeleton, borderRadius: radii.tile }]}>
        {product.photo ? <Image source={{ uri: product.photo.url }} accessibilityIgnoresInvertColors contentFit="cover" style={StyleSheet.absoluteFill} /> : null}
        {product.badge ? (
          <View style={[styles.tag, styles.badge, { backgroundColor: colors.surface }]}>
            <Text style={[styles.tagText, { color: colors.text }]}>{product.badge}</Text>
          </View>
        ) : null}
        {product.inStock ? null : (
          <View style={[styles.tag, styles.sold, { backgroundColor: colors.ink }]}>
            <Text style={[styles.tagText, { color: colors.onInk }]}>{t('product.stock.soldOut')}</Text>
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={[styles.name, { color: colors.text }]}>
        {product.name}
      </Text>
      {price ? (
        <View style={styles.prices}>
          <Text style={[styles.price, { color: colors.text }]}>{price}</Text>
          {was ? <Text style={[styles.was, { color: colors.muted }]}>{was}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  photo: { aspectRatio: 4 / 5, overflow: 'hidden' },
  tag: { position: 'absolute', height: 22, paddingHorizontal: 8, borderRadius: 5, justifyContent: 'center' },
  badge: { left: 8, top: 8 },
  sold: { left: 8, bottom: 8 },
  tagText: { fontSize: 11, fontWeight: '700' },
  name: { fontSize: 14, fontWeight: '600' },
  prices: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 },
  price: { fontSize: 14, fontWeight: '700' },
  was: { fontSize: 12, textDecorationLine: 'line-through' },
})
