import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { addToCart, productOperation, type ProductCard } from '../../api/catalogue'
import { run } from '../../api/operation'
import { useShop } from '../../api/ShopContext'
import { removeFromWishlist, wishlistOperation } from '../../api/wishlist'
import { t } from '../../messages'
import { priceLabel } from '../catalogue/ProductCardView'
import { errorKey } from '../common/errors'
import { Button, Resource, ScreenHeader, StateMessage } from '../common/ui'
import { useAction } from '../common/useAction'
import { useOperation } from '../common/useOperation'
import { useRefreshOnFocus } from '../common/useRefreshOnFocus'

/** Add to cart adds a product with one version and nothing to choose; any other opens the product to choose. */
function WishlistRow({ item, onRemoved }: { item: ProductCard; onRemoved: () => void }) {
  const router = useRouter()
  const { client, saveCartToken } = useShop()
  const { colors, radii } = useTheme()
  const action = useAction()
  const [added, setAdded] = useState(false)
  const price = priceLabel(item)

  const add = async () => {
    setAdded(false)
    const done = await action.run(async () => {
      const product = await run(client, productOperation(item.slug))
      // A product with choices or questions opens its page, where they're asked (#1373).
      const only = product && product.options.length === 0 && product.versions.length === 1 && product.questions.length === 0 ? product.versions[0] : null
      if (!only) return false
      const cartToken = await addToCart(client, only.id, 1)
      if (cartToken) await saveCartToken(cartToken)
      return true
    })
    if (done?.value) setAdded(true)
    else if (done) router.push(`/product/${item.slug}`)
  }

  const remove = async () => {
    if (await action.run(() => removeFromWishlist(client, item.id))) onRemoved()
  }

  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={[item.name, price].filter(Boolean).join(', ')} onPress={() => router.push(`/product/${item.slug}`)} style={styles.product}>
        <View style={[styles.photo, { backgroundColor: colors.skeleton, borderRadius: radii.tile }]}>
          {item.photo ? <Image source={{ uri: item.photo.url }} accessibilityIgnoresInvertColors contentFit="cover" style={StyleSheet.absoluteFill} /> : null}
        </View>
        <View style={styles.words}>
          <Text numberOfLines={2} style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
            {item.name}
          </Text>
          {price ? <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{price}</Text> : null}
          {item.inStock ? null : <Text style={{ color: colors.danger, fontSize: 13, fontWeight: '700' }}>{t('product.stock.soldOut')}</Text>}
        </View>
      </Pressable>
      {action.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
          {t(errorKey(action.error))}
        </Text>
      ) : null}
      {added ? (
        <Text accessibilityRole="alert" style={{ color: colors.success, fontWeight: '700', fontSize: 14 }}>
          {t('wishlist.added')}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        <View style={styles.button}>
          <Button saves label={t('wishlist.addToCart')} disabled={!item.inStock} busy={action.busy} onPress={() => void add()} />
        </View>
        <View style={styles.button}>
          <Button saves kind="secondary" label={t('wishlist.remove')} disabled={action.busy} onPress={() => void remove()} />
        </View>
      </View>
    </View>
  )
}

function Items({ items }: { items: ProductCard[] }) {
  const [gone, setGone] = useState<readonly string[]>([])
  const shown = items.filter((item) => !gone.includes(item.id))
  if (shown.length === 0) return <StateMessage title={t('wishlist.empty.title')} body={t('wishlist.empty.body')} />
  return (
    <View style={styles.list}>
      {shown.map((item) => (
        <WishlistRow key={item.id} item={item} onRemoved={() => setGone((now) => [...now, item.id])} />
      ))}
    </View>
  )
}

export function WishlistScreen() {
  const router = useRouter()
  const { signedIn } = useShop()
  const { colors } = useTheme()
  const { state, retry, refresh } = useOperation(signedIn ? wishlistOperation() : null)
  useRefreshOnFocus(refresh)
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t('wishlist.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
      <ScrollView contentContainerStyle={styles.content}>
        {signedIn ? (
          <Resource state={state} onRetry={retry} skeleton="list">
            {(items) => <Items items={items} />}
          </Resource>
        ) : (
          <View style={styles.guest}>
            <StateMessage title={t('wishlist.signedOut.title')} body={t('wishlist.signedOut.body')} />
            <Button label={t('auth.signInButton')} onPress={() => router.push('/sign-in')} />
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  guest: { gap: 12 },
  list: { gap: 12 },
  row: { gap: 12, padding: 12, borderWidth: 1 },
  product: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 64 },
  photo: { width: 64, aspectRatio: 4 / 5, overflow: 'hidden' },
  words: { flex: 1, gap: 4 },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { flex: 1 },
})
