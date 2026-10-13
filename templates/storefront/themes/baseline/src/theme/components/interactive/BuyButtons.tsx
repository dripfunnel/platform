'use client'

import { useId, useState } from 'react'
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
  const [note, setNote] = useState<'added' | 'failed' | null>(null)
  const [gift, setGift] = useState<GiftRecipient>({ recipientName: '', recipientEmail: '', sendOn: '', message: '' })
  const version = page.version
  const kind = page.product?.kind
  const isGift = kind?.kind === 'gift_card'
  const giftReady = gift.recipientName.trim() !== '' && emailLike.test(gift.recipientEmail.trim())
  const buyable = version !== null && version.stock.inStock && (!isGift || giftReady)
  const set = (patch: Partial<GiftRecipient>) => setGift({ ...gift, ...patch })
  const why = useId()
  const waitsForRecipient = isGift && !giftReady
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
      <AddToCart versionId={version?.id ?? null} disabled={!buyable} gift={isGift ? gift : null} describedBy={waitsForRecipient ? why : undefined} className={shop.primary} onDone={(added) => setNote(added ? 'added' : 'failed')}>
        {isGift ? t('shop.product.gift.add') : t('shop.product.add')}
      </AddToCart>
      {isGift ? null : (
        <BuyNow versionId={version?.id ?? null} disabled={!buyable} className={shop.secondary} onDone={(bought) => setNote(bought ? null : 'failed')}>
          {t('shop.product.buyNow')}
        </BuyNow>
      )}
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
