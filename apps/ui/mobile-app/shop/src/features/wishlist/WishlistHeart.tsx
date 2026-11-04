import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { useOnline } from '@dripfunnel/mobile-shared/connection'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useShop } from '../../api/ShopContext'
import { addToWishlist, removeFromWishlist, wishlistIdsOperation } from '../../api/wishlist'
import { keepPendingWishlist } from '../../session/pendingWishlist'
import { t } from '../../messages'
import { useAction } from '../common/useAction'
import { useOperation } from '../common/useOperation'

/**
 * The heart beside Add to cart (#1214). A signed-out shopper is sent to sign in, and the product is added once they have
 * (ShopProvider.startSession); `onRefused` gets the API's code for a refusal, and null when it is cleared.
 */
export function WishlistHeart({ productId, name, onRefused }: { productId: string; name: string; onRefused: (code: string | null) => void }) {
  const router = useRouter()
  const { host, client, signedIn } = useShop()
  const { colors, radii } = useTheme()
  const online = useOnline()
  const action = useAction()
  const { state } = useOperation(signedIn ? wishlistIdsOperation() : null)
  const [chosen, setChosen] = useState<boolean | null>(null)
  const kept = signedIn && state.status === 'ready' && state.data.includes(productId)
  const wishlisted = signedIn && (chosen ?? kept)
  const off = signedIn && (!online || action.busy || state.status !== 'ready')

  useEffect(() => onRefused(action.error), [action.error, onRefused])

  const press = async () => {
    if (!signedIn) {
      await keepPendingWishlist(host, productId)
      router.push('/sign-in')
      return
    }
    const next = !wishlisted
    const done = await action.run(() => (next ? addToWishlist(client, productId) : removeFromWishlist(client, productId)))
    if (done) setChosen(next)
  }

  return (
    <Pressable
      accessibilityRole="togglebutton"
      accessibilityLabel={t('wishlist.heart', { name })}
      accessibilityState={{ checked: wishlisted, disabled: off }}
      accessibilityHint={signedIn && !online ? t('states.offline.writes') : undefined}
      disabled={off}
      onPress={() => void press()}
      style={[styles.heart, { borderColor: wishlisted ? colors.brand : colors.fieldBorder, borderRadius: radii.button, backgroundColor: colors.surface }]}
    >
      <Text style={{ color: wishlisted ? colors.brand : off ? colors.muted : colors.text, fontSize: 24 }}>{wishlisted ? '♥' : '♡'}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  heart: { width: 48, height: 48, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
})
