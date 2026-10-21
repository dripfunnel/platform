import type { ReactNode } from 'react'
import { ConsentBanner, ConsentSettingsButton, Link, PoweredBy, PreviewBanner, useCart, useMenu, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Menu } from './interactive/Menu'
import { NavItem } from './interactive/NavItem'
import styles from '../styles/layout.module.css'

export const Layout = ({ children }: { children: ReactNode }) => {
  const { store, t, mode, poweredBy } = useStorefront()
  const menu = useMenu()
  const { count } = useCart()
  return (
    <div className={styles.shell}>
      {mode === 'live' ? null : <PreviewBanner t={t} className={styles.preview} />}
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link href="/" className={styles.brand}>
            {store.name}
          </Link>
          <Menu label={t('common.nav.menu')}>
            <nav className={styles.nav} aria-label={t('common.nav.label')}>
              {menu.items.length ? (
                menu.items.map((item) => <NavItem key={item.id} item={item} />)
              ) : (
                <Link href="/collections/all/" className={styles.navLink}>
                  {t('common.nav.shop')}
                </Link>
              )}
              <Link href="/about/" className={styles.navLink}>
                {t('common.nav.about')}
              </Link>
              <Link href="/contact/" className={styles.navLink}>
                {t('common.nav.contact')}
              </Link>
            </nav>
          </Menu>
          <div className={styles.tools}>
            <Link href="/search/" className={styles.tool}>
              <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M16 16l4.5 4.5" />
              </svg>
              <span className={styles.hidden}>{t('common.tools.search')}</span>
            </Link>
            <Link href="/account/" className={styles.tool}>
              <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="8.5" r="3.8" />
                <path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" />
              </svg>
              <span className={styles.hidden}>{t('common.tools.account')}</span>
            </Link>
            <Link href="/cart/" className={styles.tool}>
              <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5.5 8h13l-1 12h-11z" />
                <path d="M9 8V6.5a3 3 0 016 0V8" />
              </svg>
              <span className={styles.hidden}>{count > 0 ? t('common.tools.cartCount', { count }) : t('common.tools.cart')}</span>
              {count > 0 ? (
                <span className={styles.count} aria-hidden="true">
                  {count}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <div className={styles.columns}>
          <div className={styles.about}>
            <p className={styles.footerBrand}>{store.name}</p>
            <p className={styles.note}>{store.tagline ?? t('common.footer.note')}</p>
            {store.contactEmail ? <p className={styles.contact}>{store.contactEmail}</p> : null}
            {store.contactPhone ? <p className={styles.contact}>{store.contactPhone}</p> : null}
            {store.social.length ? (
              <div className={styles.social}>
                {store.social.map((s) => (
                  <Link key={s.network} href={s.url} className={styles.footerLink}>
                    {s.network}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <div className={styles.links}>
            <h2 className={styles.heading}>{t('common.footer.shop')}</h2>
            <Link href="/collections/all/" className={styles.footerLink}>
              {t('common.footer.all')}
            </Link>
            <Link href="/about/" className={styles.footerLink}>
              {t('common.nav.about')}
            </Link>
            <Link href="/account/" className={styles.footerLink}>
              {t('common.tools.account')}
            </Link>
          </div>
          <div className={styles.links}>
            <h2 className={styles.heading}>{t('common.footer.help')}</h2>
            <Link href="/contact/" className={styles.footerLink}>
              {t('common.nav.contact')}
            </Link>
            <Link href="/policies/shipping/" className={styles.footerLink}>
              {t('common.footer.shipping')}
            </Link>
            <Link href="/policies/returns/" className={styles.footerLink}>
              {t('common.footer.returns')}
            </Link>
          </div>
          <div className={styles.links}>
            <h2 className={styles.heading}>{t('common.footer.legal')}</h2>
            <Link href="/policies/terms/" className={styles.footerLink}>
              {t('common.footer.terms')}
            </Link>
            <Link href="/policies/privacy/" className={styles.footerLink}>
              {t('common.footer.privacy')}
            </Link>
            <Link href="/policies/legal/" className={styles.footerLink}>
              {t('common.footer.notice')}
            </Link>
          </div>
        </div>
        <div className={styles.base}>
          <ConsentSettingsButton t={t} className={styles.cookies} />
          <PoweredBy brand={poweredBy} t={t} className={styles.powered} />
        </div>
      </footer>
      <ConsentBanner t={t} className={styles.consent} />
    </div>
  )
}
