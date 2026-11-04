'use client'

import { useEffect } from 'react'
import { cx } from '../cx'
import { useStorefront, useWishlist } from '@dripfunnel/storefront-core/theme'
import styles from '../../styles/product.module.css'

const heart = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'

/** The heart beside Add to cart: pressed when the product is on the shopper's wishlist; signed out, it asks them to sign in first. */
export const WishlistHeart = ({ productId, name, versionId }: { productId: string; name: string; versionId: string | null }) => {
  const { t } = useStorefront()
  const wishlist = useWishlist()
  const on = wishlist.has(productId)
  const { chose } = wishlist
  useEffect(() => {
    if (on && versionId) chose(productId, versionId)
  }, [on, chose, productId, versionId])
  return (
    <>
      <button type="button" className={cx(styles.heart, on && styles.heartOn)} aria-pressed={on} aria-label={t('shop.wishlist.heart', { name })} disabled={wishlist.busy || wishlist.status === 'loading'} onClick={() => void wishlist.toggle(productId, versionId)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d={heart} fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </button>
      {wishlist.error ? (
        <p className={styles.added} role="status">
          {wishlist.error === 'LIMIT' ? t('shop.wishlist.full') : t('shop.wishlist.failed')}
        </p>
      ) : null}
    </>
  )
}
