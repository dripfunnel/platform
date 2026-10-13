'use client'

import { useState } from 'react'
import { AddToCart, BuyNow, Link, useStorefront, type ProductPage } from '@dripfunnel/storefront-core/theme'
import shop from '../../styles/shop.module.css'
import styles from '../../styles/product.module.css'

/** Add to cart and Buy now for the chosen version; both wait until every option is chosen and the version is in stock. */
export const BuyButtons = ({ page }: { page: ProductPage }) => {
  const { t } = useStorefront()
  const [note, setNote] = useState<'added' | 'failed' | null>(null)
  const version = page.version
  const buyable = version !== null && version.stock.inStock
  return (
    <div className={styles.buy}>
      <AddToCart versionId={version?.id ?? null} disabled={!buyable} className={shop.primary} onDone={(added) => setNote(added ? 'added' : 'failed')}>
        {t('shop.product.add')}
      </AddToCart>
      <BuyNow versionId={version?.id ?? null} disabled={!buyable} className={shop.secondary} onDone={(bought) => setNote(bought ? null : 'failed')}>
        {t('shop.product.buyNow')}
      </BuyNow>
      {note ? (
        <p className={styles.added} role="status">
          {note === 'added' ? t('shop.product.added') : t('shop.product.addFailed')}{' '}
          {note === 'added' ? (
            <Link href="/cart/" className={styles.viewCart}>
              {t('shop.product.viewCart')}
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
