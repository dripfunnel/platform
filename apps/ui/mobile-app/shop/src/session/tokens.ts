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

/** The Shop API reads the session as `X-Shop-Session` and the cart as `X-Shop-Cart`, each only when there is one (ACCESS.md §2.1). */
export const shopHeaders = ({ session, cart }: Tokens): Record<string, string> => ({
  ...(session ? { 'x-shop-session': session } : {}),
  ...(cart ? { 'x-shop-cart': cart } : {}),
})
