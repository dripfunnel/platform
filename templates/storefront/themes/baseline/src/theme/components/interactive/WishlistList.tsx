'use client'

import { useEffect, useState } from 'react'
import { AddToCart, Link, navigate, useStorefront, useWishlist, type WishlistItem } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { ProductCard } from '../ProductCard'
import { Retry } from './Retry'

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
      <div className="p-4.5 border border-line flex flex-col gap-y-3.5 gap-x-3.5 rounded-card bg-surface">
        <h2 className="m-0 font-heading text-[22px] font-[var(--heading-weight)]">{t('shop.wishlist.title')}</h2>
        <p className="m-0 text-ink-soft text-[14px]" aria-busy="true">
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
        <Link href="/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
          {t('shop.order.keepShopping')}
        </Link>
      </Notice>
    )
  }
  return (
    <div className="p-4.5 border border-line flex flex-col gap-y-3.5 gap-x-3.5 rounded-card bg-surface">
      <h2 className="m-0 font-heading text-[22px] font-[var(--heading-weight)]">{t('shop.wishlist.title')}</h2>
      {wishlist.error ? (
        <p className="py-3 px-3.5 m-0 border border-line rounded-card bg-soft text-ink" role="alert">
          {t('shop.wishlist.failed')}
        </p>
      ) : null}
      <ul className="p-0 m-0 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-y-5 gap-x-5 list-none">
        {wishlist.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-y-3 gap-x-3">
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
    <div className="flex flex-wrap gap-y-2 gap-x-2 [&>a]:flex-[1_1_120px] [&>a]:self-stretch [&>button]:flex-[1_1_120px] [&>button]:self-stretch [&>p]:m-0 [&>p]:basis-[100%]">
      {item.versionId ? (
        <AddToCart versionId={item.versionId} className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" onDone={setAdded}>
          {t('shop.wishlist.add')}
        </AddToCart>
      ) : (
        <Link href={item.href} className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
          {item.stock.inStock ? t('shop.wishlist.choose') : t('shop.wishlist.view')}
        </Link>
      )}
      <button type="button" className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" aria-label={t('shop.wishlist.removeLabel', { name: item.name })} disabled={busy} onClick={() => void onRemove()}>
        {t('shop.wishlist.remove')}
      </button>
      {added !== null ? (
        <p className="m-0 text-ink-soft text-[14px]" role="status">
          {added ? t('shop.wishlist.added') : t('shop.wishlist.addFailed')}
        </p>
      ) : null}
    </div>
  )
}
