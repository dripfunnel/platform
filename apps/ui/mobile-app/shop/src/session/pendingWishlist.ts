import AsyncStorage from '@react-native-async-storage/async-storage'

// The product a signed-out shopper hearted, kept on the phone until they sign in (#1214). It is only a product id, and it
// expires, so a sign-in abandoned today does not add a product to an account hours later.
export const pendingWishlistMinutes = 60

const key = (host: string) => `df.wishlist.pending.${host}`

export const keepPendingWishlist = (host: string, productId: string, now = Date.now()): Promise<void> =>
  AsyncStorage.setItem(key(host), JSON.stringify({ id: productId, at: now })).catch(() => undefined)

/** The kept product, once: reading it removes it. Null when none was kept or it has expired. */
export const takePendingWishlist = async (host: string, now = Date.now()): Promise<string | null> => {
  try {
    const raw = await AsyncStorage.getItem(key(host))
    await AsyncStorage.removeItem(key(host))
    const kept: unknown = JSON.parse(raw ?? 'null')
    if (typeof kept !== 'object' || kept === null) return null
    const { id, at } = kept as { id?: unknown; at?: unknown }
    return typeof id === 'string' && typeof at === 'number' && now - at <= pendingWishlistMinutes * 60_000 ? id : null
  } catch {
    return null
  }
}

export const dropPendingWishlist = (host: string): Promise<void> => AsyncStorage.removeItem(key(host)).catch(() => undefined)
