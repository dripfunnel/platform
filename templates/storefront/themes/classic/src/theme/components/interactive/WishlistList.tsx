'use client'

import { useEffect, useState } from 'react'
import { AddToCart, Link, navigate, useStorefront, useWishlist, type WishlistItem } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { ProductCard } from '../ProductCard'
import { Retry } from './Retry'
import shop from '../../styles/shop.module.css'
import styles from '../../styles/account.module.css'

const here = '/account/wishlist/'

/** The shopper's wishlist, newest first: each product with Add to cart (or its page, to choose options) and Remove. */
export const WishlistList = () => {
  const { t } = useStorefront()
  const wishlist = useWishlist({ cards: true })
  useEffect(() => {
    if (wishlist.status === 'signedOut') navigate(`/sign-in/?next=${here}`, { replace: true })
  }, [wishlist.status])

  if (wishlist.status === 'loading' || wishlist.status === 'signedOut') {
    return (
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>{t('shop.wishlist.title')}</h2>
        <p className={styles.note} aria-busy="true">
          {t('shop.wishlist.loading')}
        </p>
      </div>
    )
  }
  if (wishlist.status === 'error') {
    return (
      <Notice title={t('shop.wishlist.loadFailed')} lead={t('shop.listing.failedLead')}>
        <Retry label={t('shop.listing.retry')} onRetry={wishlist.retry} />
      </Notice>
    )
  }
  if (wishlist.items.length === 0) {
    return (
      <Notice title={t('shop.wishlist.empty')} lead={t('shop.wishlist.emptyLead')}>
        <Link href="/" className={shop.primary}>
          {t('shop.order.keepShopping')}
        </Link>
      </Notice>
    )
  }
  return (
    <div className={styles.card}>
      <h2 className={styles.cardTitle}>{t('shop.wishlist.title')}</h2>
      {wishlist.error ? (
        <p className={styles.alert} role="alert">
          {t('shop.wishlist.failed')}
        </p>
      ) : null}
      <ul className={styles.wishlist}>
        {wishlist.items.map((item) => (
          <li key={item.id} className={styles.wished}>
            <ProductCard product={item} />
            <Actions item={item} onRemove={() => wishlist.remove(item.id)} busy={wishlist.busy} />
          </li>
        ))}
      </ul>
    </div>
  )
}

const Actions = ({ item, onRemove, busy }: { item: WishlistItem; onRemove: () => Promise<boolean>; busy: boolean }) => {
  const { t } = useStorefront()
  const [added, setAdded] = useState<boolean | null>(null)
  return (
    <div className={styles.wishActions}>
      {item.versionId ? (
        <AddToCart versionId={item.versionId} className={shop.primary} onDone={setAdded}>
          {t('shop.wishlist.add')}
        </AddToCart>
      ) : (
        <Link href={item.href} className={shop.primary}>
          {item.stock.inStock ? t('shop.wishlist.choose') : t('shop.wishlist.view')}
        </Link>
      )}
      <button type="button" className={shop.secondary} aria-label={t('shop.wishlist.removeLabel', { name: item.name })} disabled={busy} onClick={() => void onRemove()}>
        {t('shop.wishlist.remove')}
      </button>
      {added !== null ? (
        <p className={styles.note} role="status">
          {added ? t('shop.wishlist.added') : t('shop.wishlist.addFailed')}
        </p>
      ) : null}
    </div>
  )
}
