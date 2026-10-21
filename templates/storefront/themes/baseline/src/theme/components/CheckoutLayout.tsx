import type { ReactNode } from 'react'
import { ConsentBanner, ConsentSettingsButton, Link, PoweredBy, PreviewBanner, useStorefront } from '@dripfunnel/storefront-core/theme'
import layout from '../styles/layout.module.css'
import styles from '../styles/checkout.module.css'

/** Checkout's own frame (D1): the shop's name, "Secure checkout" and the way back to the cart, without the menu. */
export const CheckoutLayout = ({ children }: { children: ReactNode }) => {
  const { store, t, mode, poweredBy } = useStorefront()
  return (
    <div className={layout.shell}>
      {mode === 'live' ? null : <PreviewBanner t={t} className={layout.preview} />}
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link href="/" className={layout.brand}>
            {store.name}
          </Link>
          <p className={styles.secure}>
            <svg className={styles.lock} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect x="5" y="10.5" width="14" height="10" rx="2" />
              <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
            </svg>
            {t('shop.checkout.secure')}
          </p>
          <Link href="/cart/" className={styles.back}>
            {t('shop.checkout.backToCart')}
          </Link>
        </div>
      </header>
      <main className={layout.main}>{children}</main>
      <footer className={styles.footer}>
        <ConsentSettingsButton t={t} className={layout.cookies} />
        <PoweredBy brand={poweredBy} t={t} className={layout.powered} />
      </footer>
      <ConsentBanner t={t} className={layout.consent} />
    </div>
  )
}
