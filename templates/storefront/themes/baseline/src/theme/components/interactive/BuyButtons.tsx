'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { AddToCart, BuyNow, Link, TextField, useStorefront, type GiftRecipient, type ProductPage } from '@dripfunnel/storefront-core/theme'
import shop from '../../styles/shop.module.css'
import styles from '../../styles/product.module.css'

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
    <div className={styles.buy}>
      {kind?.kind === 'digital' ? (
        <p className={styles.kindNote}>{kind.downloadLimit !== null && kind.downloadDays !== null ? t('shop.product.download', { times: kind.downloadLimit, days: kind.downloadDays }) : t('shop.product.downloadPlain')}</p>
      ) : null}
      {kind?.kind === 'service' ? <p className={styles.kindNote}>{[kind.duration, kind.location].filter(Boolean).join(' · ') || t('shop.product.service')}</p> : null}
      {kind?.kind === 'gift_card' ? (
        <div className={styles.gift}>
          <TextField label={t('shop.product.gift.name')} autoComplete="off" value={gift.recipientName} onChange={(recipientName) => set({ recipientName })} className={styles.field} />
          <TextField label={t('shop.product.gift.email')} type="email" autoComplete="off" value={gift.recipientEmail} onChange={(recipientEmail) => set({ recipientEmail })} className={styles.field} />
          <TextField label={t('shop.product.gift.message')} note={t('shop.product.gift.optional')} maxLength={200} value={gift.message ?? ''} onChange={(message) => set({ message })} className={styles.field} />
          <TextField
            label={t('shop.product.gift.sendOn')}
            type="date"
            value={gift.sendOn ?? ''}
            onChange={(sendOn) => set({ sendOn })}
            hint={kind.expiryMonths !== null ? t('shop.product.gift.sendHintExpiry', { months: kind.expiryMonths }) : t('shop.product.gift.sendHint')}
            className={styles.field}
          />
        </div>
      ) : null}
      {waitsForRecipient ? (
        <p id={why} className={styles.kindNote}>
          {t('shop.product.gift.needed')}
        </p>
      ) : null}
      {inCart ? (
        <Link href="/cart/" className={shop.primary} ref={goToCart}>
          {t('shop.product.goToCart')}
        </Link>
      ) : (
        <AddToCart
          versionId={version?.id ?? null}
          disabled={!buyable}
          gift={isGift ? gift : null}
          describedBy={waitsForRecipient ? why : undefined}
          className={shop.primary}
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
        <BuyNow versionId={version?.id ?? null} disabled={!buyable} className={shop.secondary} onDone={(bought) => setFailed(!bought)}>
          {t('shop.product.buyNow')}
        </BuyNow>
      )}
      {failed || added ? (
        <p className={styles.added} role="status">
          {failed ? t('shop.product.addFailed') : t('shop.product.added')}
        </p>
      ) : null}
    </div>
  )
}
