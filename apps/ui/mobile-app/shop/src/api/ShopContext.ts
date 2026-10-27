import { createContext, useContext } from 'react'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'

/** What reads one order: its client, and the headers a request for its images must carry. */
export type OrderAccess = { client: ApiClient; headers: Record<string, string> }

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
  /** Keeps the cart token that placed a guest's order, so the order can be read after the next cart replaces it (api/ACCESS.md §2.1). */
  keepOrderToken: (orderId: string) => Promise<void>
  /** An order is read by the token kept for it when a guest placed it, otherwise as the session reads it. */
  orderAccess: (orderId: string) => Promise<OrderAccess>
}

export const ShopContext = createContext<Shop | null>(null)

export const useShop = (): Shop => {
  const shop = useContext(ShopContext)
  if (!shop) throw new Error('useShop needs a ShopProvider above it.')
  return shop
}
