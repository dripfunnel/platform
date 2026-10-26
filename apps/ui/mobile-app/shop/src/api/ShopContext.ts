import { createContext, useContext } from 'react'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'

export type Shop = {
  host: string
  client: ApiClient
  /** Keeps the cart token `addToCart` answers, so every later call carries it. */
  saveCartToken: (token: string) => Promise<void>
  /** Whether a customer's session token is held. The API still decides whether it is any good. */
  signedIn: boolean
  /** Keeps the session token a sign-in answers; the guest cart it claimed is the account's now. */
  startSession: (token: string) => Promise<void>
  /** Ends the session on the server as far as it can, then removes the token from the phone whatever the server said. */
  endSession: () => Promise<void>
}

export const ShopContext = createContext<Shop | null>(null)

export const useShop = (): Shop => {
  const shop = useContext(ShopContext)
  if (!shop) throw new Error('useShop needs a ShopProvider above it.')
  return shop
}
