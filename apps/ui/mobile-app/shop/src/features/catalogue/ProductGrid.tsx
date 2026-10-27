import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { ProductCard } from '../../api/catalogue'
import { t } from '../../messages'
import { cardGap, ProductCardView, screenPadding } from './ProductCardView'
import { Button } from '../common/ui'
import type { MoreState } from './usePaged'

export function ProductGrid({ products, onOpen }: { products: ProductCard[]; onOpen: (slug: string) => void }) {
  return (
    <View style={styles.grid}>
      {products.map((product) => (
        <ProductCardView key={product.id} product={product} onOpen={onOpen} />
      ))}
    </View>
  )
}

/** "Show more" under a list: the next page when there is one, and what went wrong when it did not load. */
export function ShowMore({ next, more, onPress }: { next: string | null; more: MoreState; onPress: () => void }) {
  const { colors } = useTheme()
  if (next === null) return null
  return (
    <View style={styles.more}>
      {more === 'error' || more === 'offline' ? (
        <Text accessibilityRole="alert" style={[styles.moreNote, { color: colors.danger }]}>
          {t(more === 'offline' ? 'states.moreOffline' : 'states.moreFailed')}
        </Text>
      ) : null}
      <Button kind="secondary" label={more === 'idle' || more === 'loading' ? t('states.showMore') : t('states.retry')} busy={more === 'loading'} onPress={onPress} />
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: cardGap, rowGap: 18, paddingHorizontal: screenPadding },
  more: { gap: 8, paddingHorizontal: screenPadding, paddingVertical: 20 },
  moreNote: { fontSize: 13, textAlign: 'center' },
})
