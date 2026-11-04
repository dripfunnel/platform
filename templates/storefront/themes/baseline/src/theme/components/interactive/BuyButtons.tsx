'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { AddToCart, BuyNow, Link, TextField, useStorefront, type GiftRecipient, type ProductPage } from '@dripfunnel/storefront-core/theme'
import { WishlistHeart } from './WishlistHeart'

const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Add to cart and Buy now for the chosen version; both wait until every option is chosen and the version is in stock.
 * A gift card asks for its recipient first, as D1's gift card page does; a download or a service says what the shopper gets.
 */
export const BuyButtons = ({ page }: { page: ProductPage }) => {
  const { t } = useStorefront()
  const [addedId, setAddedId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [gift, setGift] = useState<GiftRecipient>({ recipientName: '', recipientEmail: '', sendOn: '', message: '' })
  const version = page.version
  const kind = page.product?.kind
  const isGift = kind?.kind === 'gift_card'
  const giftReady = gift.recipientName.trim() !== '' && emailLike.test(gift.recipientEmail.trim())
  const buyable = version !== null && version.stock.inStock && (!isGift || giftReady)
  const set = (patch: Partial<GiftRecipient>) => setGift({ ...gift, ...patch })
  const why = useId()
  const waitsForRecipient = isGift && !giftReady
  const added = version !== null && addedId === version.id
  // A gift card keeps Add to cart, so a second one can go to someone else.
  const inCart = added && !isGift
  // Go to cart replaces the button just pressed, so focus moves to it rather than dropping to the page (WCAG 2.4.3).
  const goToCart = useRef<HTMLAnchorElement>(null)
  const justAdded = useRef(false)
  useEffect(() => {
    if (inCart && justAdded.current) goToCart.current?.focus()
    justAdded.current = false
  }, [inCart])
  return (
    <div className="group/product-buy flex self-stretch flex-wrap gap-y-2.5 gap-x-2.5 [&>button]:flex-[1_1_180px] [&>a]:flex-[1_1_180px] [&>button:disabled]:opacity-[0.55] [&>button:disabled]:cursor-default">
      {kind?.kind === 'digital' ? (
        <p className="m-0 basis-[100%] text-ink-soft text-[14px]">{kind.downloadLimit !== null && kind.downloadDays !== null ? t('shop.product.download', { times: kind.downloadLimit, days: kind.downloadDays }) : t('shop.product.downloadPlain')}</p>
      ) : null}
      {kind?.kind === 'service' ? <p className="m-0 basis-[100%] text-ink-soft text-[14px]">{[kind.duration, kind.location].filter(Boolean).join(' · ') || t('shop.product.service')}</p> : null}
      {kind?.kind === 'gift_card' ? (
        <div className="grid basis-[100%] gap-y-3 gap-x-3">
          <TextField label={t('shop.product.gift.name')} autoComplete="off" value={gift.recipientName} onChange={(recipientName) => set({ recipientName })} className="grid gap-y-1.5 gap-x-1.5 [&_label]:text-[14px] [&_label]:font-semibold [&_small]:text-muted [&_small]:text-[13px] [&_small]:font-normal [&_input]:py-0 [&_input]:px-3.5 [&_input]:border [&_input]:border-line [&_input]:min-h-12 [&_input]:box-border [&_input]:rounded-[calc(var(--radius-card)_-_4px)] [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit]" />
          <TextField label={t('shop.product.gift.email')} type="email" autoComplete="off" value={gift.recipientEmail} onChange={(recipientEmail) => set({ recipientEmail })} className="grid gap-y-1.5 gap-x-1.5 [&_label]:text-[14px] [&_label]:font-semibold [&_small]:text-muted [&_small]:text-[13px] [&_small]:font-normal [&_input]:py-0 [&_input]:px-3.5 [&_input]:border [&_input]:border-line [&_input]:min-h-12 [&_input]:box-border [&_input]:rounded-[calc(var(--radius-card)_-_4px)] [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit]" />
          <TextField label={t('shop.product.gift.message')} note={t('shop.product.gift.optional')} maxLength={200} value={gift.message ?? ''} onChange={(message) => set({ message })} className="grid gap-y-1.5 gap-x-1.5 [&_label]:text-[14px] [&_label]:font-semibold [&_small]:text-muted [&_small]:text-[13px] [&_small]:font-normal [&_input]:py-0 [&_input]:px-3.5 [&_input]:border [&_input]:border-line [&_input]:min-h-12 [&_input]:box-border [&_input]:rounded-[calc(var(--radius-card)_-_4px)] [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit]" />
          <TextField
            label={t('shop.product.gift.sendOn')}
            type="date"
            value={gift.sendOn ?? ''}
            onChange={(sendOn) => set({ sendOn })}
            hint={kind.expiryMonths !== null ? t('shop.product.gift.sendHintExpiry', { months: kind.expiryMonths }) : t('shop.product.gift.sendHint')}
            className="grid gap-y-1.5 gap-x-1.5 [&_label]:text-[14px] [&_label]:font-semibold [&_small]:text-muted [&_small]:text-[13px] [&_small]:font-normal [&_input]:py-0 [&_input]:px-3.5 [&_input]:border [&_input]:border-line [&_input]:min-h-12 [&_input]:box-border [&_input]:rounded-[calc(var(--radius-card)_-_4px)] [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit]"
          />
        </div>
      ) : null}
      {waitsForRecipient ? (
        <p id={why} className="m-0 basis-[100%] text-ink-soft text-[14px]">
          {t('shop.product.gift.needed')}
        </p>
      ) : null}
      {inCart ? (
        <Link href="/cart/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" ref={goToCart}>
          {t('shop.product.goToCart')}
        </Link>
      ) : (
        <AddToCart
          versionId={version?.id ?? null}
          disabled={!buyable}
          gift={isGift ? gift : null}
          describedBy={waitsForRecipient ? why : undefined}
          className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]"
          onDone={(worked) => {
            setFailed(!worked)
            if (!worked) return
            justAdded.current = true
            setAddedId(version?.id ?? null)
          }}
        >
          {isGift ? t('shop.product.gift.add') : t('shop.product.add')}
        </AddToCart>
      )}
      {isGift ? null : (
        <BuyNow versionId={version?.id ?? null} disabled={!buyable} className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" onDone={(bought) => setFailed(!bought)}>
          {t('shop.product.buyNow')}
        </BuyNow>
      )}
      {page.product ? <WishlistHeart productId={page.product.id} name={page.product.name} versionId={version?.id ?? null} /> : null}
      {failed || added ? (
        <p className="m-0 basis-[100%] text-ink-soft text-[14px]" role="status">
          {failed ? t('shop.product.addFailed') : t('shop.product.added')}
        </p>
      ) : null}
    </div>
  )
}
