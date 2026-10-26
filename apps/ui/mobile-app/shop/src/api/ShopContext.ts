import { createContext, useContext } from 'react'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'

export type Shop = {
  host: string
  client: ApiClient
  /** Keeps the cart token `addToCart` answers, so every later call carries it. */
  saveCartToken: (token: string) => Promise<void>
}

export const ShopContext = createContext<Shop | null>(null)

export const useShop = (): Shop => {
  const shop = useContext(ShopContext)
  if (!shop) throw new Error('useShop needs a ShopProvider above it.')
  return shop
}
