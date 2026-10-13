'use client'

import type { ReactNode } from 'react'
import { useCart, type GiftRecipient } from './cart'

// Add to cart and Buy now (storefront ARCHITECTURE §3.2 "add-to-cart that uses useCart"): the theme words and styles them;
// core does what they do, and marks them so the checkout smoke test (§4.2) finds them in any theme.

type Props = {
  /** The version to buy; null while options are still to choose, which disables the button. */
  versionId: string | null
  quantity?: number
  disabled?: boolean
  className?: string
  children: ReactNode
  /** Hears whether it worked, to say so beside the button. */
  onDone?: (worked: boolean) => void
  /** A gift card's recipient; the engine refuses a gift card without one. */
  gift?: GiftRecipient | null
}

export const AddToCart = ({ versionId, quantity = 1, disabled = false, className, children, onDone, gift }: Props) => {
  const cart = useCart()
  return (
    <button type="button" className={className} data-df-action="add-to-cart" disabled={disabled || versionId === null} onClick={() => (versionId ? void cart.add(versionId, quantity, gift ?? undefined).then((worked) => onDone?.(worked)) : undefined)}>
      {children}
    </button>
  )
}

/** Adds the version, then opens checkout. */
export const BuyNow = ({ versionId, quantity = 1, disabled = false, className, children, onDone, gift }: Props) => {
  const cart = useCart()
  return (
    <button type="button" className={className} data-df-action="buy-now" disabled={disabled || versionId === null} onClick={() => (versionId ? void cart.buyNow(versionId, quantity, gift ?? undefined).then((worked) => onDone?.(worked)) : undefined)}>
      {children}
    </button>
  )
}
