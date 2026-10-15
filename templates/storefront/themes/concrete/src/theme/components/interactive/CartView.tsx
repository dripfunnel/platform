'use client'

import { useState } from 'react'
import { clsx } from 'clsx'
import { CodeField, Image, Link, OrderSummary, Price, useCart, useStorefront, type CartLine } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { Retry } from './Retry'
import shop from '../../styles/shop.module.css'
import styles from '../../styles/cart.module.css'

const Minus = () => (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 12h12" />
  </svg>
)
const Plus = () => (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 12h12M12 6v12" />
  </svg>
)

/** The cart page's body: its lines, the engine's summary, codes and the way to checkout, with each state it can be in. */
export const CartView = () => {
  const { store, locale, t } = useStorefront()
  const page = useCart()
  const [codeNote, setCodeNote] = useState<{ words: string; refused: boolean } | null>(null)
  const codeWord = (state: string) =>
    state === 'APPLIED'
      ? t('shop.cart.codes.applied')
      : state === 'NOT_ELIGIBLE'
        ? t('shop.cart.codes.notEligible')
        : state === 'DOESNT_COMBINE'
          ? t('shop.cart.codes.doesntCombine')
          : state === 'SIGN_IN_REQUIRED'
            ? t('shop.cart.codes.signIn')
            : state === 'EXPIRED'
              ? t('shop.cart.codes.expired')
              : state === 'USED_UP'
                ? t('shop.cart.codes.usedUp')
                : state === 'ALREADY_USED'
                  ? t('shop.cart.codes.alreadyUsed')
                  : t('shop.cart.codes.invalid')
  const problemWords = (line: CartLine) =>
    line.problem === 'short' && line.available !== null ? t('shop.cart.problems.short', { count: line.available }) : line.problem === 'not_sold_here' ? t('shop.cart.problems.notSoldHere') : line.problem ? t('shop.cart.problems.unavailable') : null

  if (page.status === 'loading') {
    return (
      <section className={shop.page} aria-busy="true">
        <h1 className={shop.title}>{t('shop.cart.title')}</h1>
        <p className={shop.lead}>{t('shop.cart.loading')}</p>
      </section>
    )
  }
  if (page.status === 'error') {
    return (
      <section className={shop.page}>
        <Notice main title={t('shop.cart.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={page.retry} />
        </Notice>
      </section>
    )
  }
  const cart = page.cart
  if (!cart || cart.lines.length === 0) {
    return (
      <section className={shop.page}>
        <Notice main title={t('shop.cart.empty')} lead={t('shop.cart.emptyLead')}>
          <Link href="/collections/all/" className={shop.primary}>
            {t('shop.cart.keepShopping')}
          </Link>
        </Notice>
      </section>
    )
  }
  const blocked = cart.lines.some((l) => l.problem !== null)
  return (
    <section className={shop.page}>
      <h1 className={shop.title}>{t('shop.cart.title')}</h1>
      {page.error ? (
        <p className={styles.alert} role="alert">
          {t('shop.cart.changeFailed')}
        </p>
      ) : null}
      <div className={styles.cart}>
        <ul className={styles.lines}>
          {cart.lines.map((line) => (
            <li key={line.versionId} className={clsx(styles.line, line.pending && styles.pending)}>
              {line.photo ? <Image image={line.photo} alt={line.name} ratio={0.8} sizes="88px" className={styles.photo} /> : <span className={styles.noPhoto} />}
              <div className={styles.info}>
                <div className={styles.top}>
                  {line.href ? (
                    <Link href={line.href} className={styles.name}>
                      {line.name}
                    </Link>
                  ) : (
                    <p className={styles.name}>{line.name}</p>
                  )}
                  {line.lineTotal ? <Price money={line.lineTotal} includesTax={store.pricesIncludeTax} locale={locale} t={t} className={styles.price} /> : null}
                </div>
                {line.versionName ? <p className={styles.version}>{line.versionName}</p> : null}
                {line.gift ? <p className={styles.version}>{t('shop.cart.giftFor', { name: line.gift.recipientName, email: line.gift.recipientEmail })}</p> : null}
                {problemWords(line) ? <p className={styles.problem}>{problemWords(line)}</p> : null}
                <div className={styles.actions}>
                  <div className={styles.stepper} role="group" aria-label={t('shop.cart.quantity', { name: line.name })}>
                    <button type="button" className={styles.step} aria-label={t('shop.cart.less')} disabled={line.quantity <= 1} onClick={() => void page.setQuantity(line.versionId, line.quantity - 1)}>
                      <Minus />
                    </button>
                    <span className={styles.quantity} aria-live="polite">
                      {line.quantity}
                    </span>
                    <button type="button" className={styles.step} aria-label={t('shop.cart.more')} onClick={() => void page.setQuantity(line.versionId, line.quantity + 1)}>
                      <Plus />
                    </button>
                  </div>
                  <button type="button" className={styles.remove} onClick={() => void page.remove(line.versionId)}>
                    {t('shop.cart.remove')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <aside className={styles.side}>
          <h2 className={styles.sideTitle}>
            {t('shop.cart.summary')}
          </h2>
          <OrderSummary cart={cart} at="cart" locale={locale} t={t} className={styles.summary} />
          <CodeField
            label={t('shop.cart.code')}
            button={t('shop.cart.apply')}
            message={codeNote?.words ?? null}
            refused={codeNote?.refused ?? false}
            className={styles.code}
            onApply={async (code) => {
              const state = await page.applyCode(code)
              setCodeNote({ words: state ? codeWord(state) : t('shop.cart.changeFailed'), refused: state !== 'APPLIED' })
              return state === 'APPLIED'
            }}
          />
          {cart.codes.length ? (
            <ul className={styles.codes}>
              {cart.codes.map((c) => (
                <li key={c.code} className={styles.chip}>
                  <span>{c.code}</span>
                  <button type="button" className={styles.remove} aria-label={t('shop.cart.removeCode', { code: c.code })} onClick={() => void page.removeCode(c.code)}>
                    {t('shop.cart.remove')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {blocked ? (
            <>
              <p className={styles.problem}>{t('shop.cart.blocked')}</p>
              <button type="button" className={clsx(shop.primary, styles.checkout)} disabled>
                {t('shop.cart.checkout')}
              </button>
            </>
          ) : (
            <Link href="/checkout/" className={clsx(shop.primary, styles.checkout)}>
              {t('shop.cart.checkout')}
            </Link>
          )}
        </aside>
      </div>
    </section>
  )
}
