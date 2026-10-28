import AsyncStorage from '@react-native-async-storage/async-storage'
import { secureStorage } from '@dripfunnel/mobile-shared/storage'

// The customer's session token and a guest's cart token, each kept in the phone's secure storage, keyed by the
// store's host (shop/ARCHITECTURE.md §4). Neither has a "last used" value, so both are read with none.
export type Tokens = { session: string | null; cart: string | null }

const noLast = (): null => null

const sessionStorage = (host: string) => secureStorage<null>(host, noLast)
const cartStorage = (host: string) => secureStorage<null>(`${host}.cart`, noLast)

/** What the keystore holds; a keystore that fails reads as no tokens, so the person browses as a guest. */
export const loadTokens = async (host: string): Promise<Tokens> => {
  const [session, cart] = await Promise.all([sessionStorage(host).read(), cartStorage(host).read()])
  return { session: session.token, cart: cart.token }
}

/** The customer's session token, as `signIn` and `verifySignInCode` answer it; the next call carries it as `X-Shop-Session`. */
export const saveSessionToken = (host: string, token: string): Promise<void> => sessionStorage(host).writeToken(token)

/** Sign-out and an ended session: the token is removed from secure storage (and marked revoked if the keystore would not let go, so it is not used). */
export const clearSessionToken = (host: string): Promise<void> => sessionStorage(host).wipe()

/** A guest's cart token, as `addToCart` answers it; the next call carries it as `X-Shop-Cart`. */
export const saveCartToken = (host: string, token: string): Promise<void> => cartStorage(host).writeToken(token)

/** After sign-in the guest cart belongs to the account, so the guest's token is no longer needed. */
export const clearCartToken = (host: string): Promise<void> => cartStorage(host).wipe()

const orderStorage = (host: string, orderId: string) => secureStorage<null>(`${host}.order.${orderId}`, noLast)

// A kept token reads its order, so each is a bearer credential: it lasts 30 days, and the phone keeps the 20 newest. The list holds ids and times, never a token.
export const orderTokenDays = 30
export const orderTokensKept = 20
const dayMs = 86_400_000

type Kept = { id: string; at: number }
const keptKey = (host: string) => `df.orders.kept.${host}`

const readKept = async (host: string): Promise<Kept[]> => {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(keptKey(host))) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((k): k is Kept => typeof k?.id === 'string' && typeof k?.at === 'number') : []
  } catch {
    return []
  }
}
const writeKept = (host: string, kept: Kept[]) => AsyncStorage.setItem(keptKey(host), JSON.stringify(kept)).catch(() => undefined)

/** A guest's cart becomes the order (the order's id is the cart's), so the token that placed it reads it: kept apart, since the next cart's token replaces the cart token. */
export const keepOrderToken = async (host: string, orderId: string, now = Date.now()): Promise<void> => {
  const { cart } = await loadTokens(host)
  if (!cart) return
  await orderStorage(host, orderId).writeToken(cart)
  const all = [{ id: orderId, at: now }, ...(await readKept(host)).filter((k) => k.id !== orderId)]
  const kept = all.filter((k) => now - k.at <= orderTokenDays * dayMs).sort((a, b) => b.at - a.at).slice(0, orderTokensKept)
  await Promise.all(all.filter((k) => !kept.includes(k)).map((k) => orderStorage(host, k.id).wipe()))
  await writeKept(host, kept)
}

/** The token kept for a guest's order, or null for an order a session reads and for one whose token has expired (and is removed). */
export const loadOrderToken = async (host: string, orderId: string, now = Date.now()): Promise<string | null> => {
  const kept = await readKept(host)
  const entry = kept.find((k) => k.id === orderId)
  if (!entry) return null
  if (now - entry.at > orderTokenDays * dayMs) {
    await orderStorage(host, orderId).wipe()
    await writeKept(host, kept.filter((k) => k !== entry))
    return null
  }
  return (await orderStorage(host, orderId).read()).token
}

/** The Shop API reads the session as `X-Shop-Session` and the cart as `X-Shop-Cart`, each only when there is one (ACCESS.md §2.1). */
export const shopHeaders = ({ session, cart }: Tokens): Record<string, string> => ({
  ...(session ? { 'x-shop-session': session } : {}),
  ...(cart ? { 'x-shop-cart': cart } : {}),
})
