import type { ReactNode } from 'react'
import { ConsentBanner, ConsentSettingsButton, Link, navigate, PoweredBy, PreviewBanner, SearchField, StoreLogo, useCart, useCollections, useMenu, useStorefront, useWishlist } from '@dripfunnel/storefront-core/theme'
import { Menu } from './interactive/Menu'
import { NavItem } from './interactive/NavItem'
import styles from '../styles/layout.module.css'

// The theme rules allow no URL encoding, so the characters that would break the query are dropped instead.
const searchFor = (words: string) => navigate(`/search/?q=${words.replace(/[&+%#]/g, ' ').trim()}`)

export const Layout = ({ children }: { children: ReactNode }) => {
  const { store, t, mode, poweredBy } = useStorefront()
  const menu = useMenu()
  // `first: 20` matches the home page's request, so both share one answer.
  const { collections: fetched, status } = useCollections({ first: 20 })
  const collections = status === 'ready' ? fetched : []
  const { count } = useCart()
  const { count: wished } = useWishlist()
  const whatsapp = store.social.find((s) => s.network === 'whatsapp')
  return (
    <div className={styles.shell}>
      {mode === 'live' ? null : <PreviewBanner t={t} className={styles.preview} />}
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link href="/" className={styles.brand}>
            <StoreLogo className={styles.logo} />
          </Link>
          <SearchField label={t('common.tools.search')} placeholder={t('common.tools.searchPrompt')} button={t('common.tools.search')} value="" onSearch={searchFor} suggest={4} className={styles.search} />
          <div className={styles.tools}>
            <Link href="/account/" className={styles.account}>
              <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="8.5" r="3.8" />
                <path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" />
              </svg>
              <span className={styles.accountLabel}>{t('common.tools.account')}</span>
            </Link>
            <span className={styles.divider} aria-hidden="true" />
            <Link href="/account/wishlist/" className={styles.tool}>
              <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z" />
              </svg>
              <span className={styles.hidden}>{wished > 0 ? t('common.tools.wishlistCount', { count: wished }) : t('common.tools.wishlist')}</span>
              {wished > 0 ? (
                <span className={styles.count} aria-hidden="true">
                  {wished}
                </span>
              ) : null}
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
      <div className={styles.navBar}>
        <div className={styles.navInner}>
          <Menu label={t('common.nav.menu')}>
            <nav className={styles.nav} aria-label={t('common.nav.label')}>
              <Link href="/" className={styles.navLink}>
                {t('common.nav.home')}
              </Link>
              {menu.items.length ? (
                menu.items.map((item) => <NavItem key={item.id} item={item} />)
              ) : (
                <>
                  <Link href="/collections/all/" className={styles.navLink}>
                    {t('common.nav.shopAll')}
                  </Link>
                  {collections.map((c) => (
                    <Link key={c.id} href={c.href} className={styles.navLink}>
                      {c.name}
                    </Link>
                  ))}
                  <Link href="/about/" className={styles.navLink}>
                    {t('common.nav.about')}
                  </Link>
                  <Link href="/contact/" className={styles.navLink}>
                    {t('common.nav.contact')}
                  </Link>
                </>
              )}
            </nav>
          </Menu>
          <ul className={styles.chips}>
            <li>
              <Link href="/collections/all/" className={styles.chip}>
                {t('common.nav.shopAll')}
              </Link>
            </li>
            {collections.map((c) => (
              <li key={c.id}>
                <Link href={c.href} className={styles.chip}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <div className={styles.columns}>
          <div className={styles.about}>
            <p className={styles.footerBrand}>{store.name}</p>
            {store.tagline ? <p className={styles.tagline}>{store.tagline}</p> : null}
            <p className={styles.note}>{store.description || t('common.footer.note')}</p>
            {store.social.length ? (
              <div className={styles.social}>
                {store.social.map((s) => (
                  <Link key={s.network} href={s.url} className={styles.socialLink}>
                    {s.network}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <div className={styles.links}>
            <h2 className={styles.heading}>{t('common.footer.shop')}</h2>
            {menu.items.length ? (
              menu.items.map((item) => (
                <Link key={item.id} href={item.href} className={styles.footerLink}>
                  {item.label}
                </Link>
              ))
            ) : (
              <Link href="/collections/all/" className={styles.footerLink}>
                {t('common.footer.all')}
              </Link>
            )}
          </div>
          <div className={styles.links}>
            <h2 className={styles.heading}>{t('common.footer.help')}</h2>
            <Link href="/collections/all/" className={styles.footerLink}>
              {t('common.footer.all')}
            </Link>
            <Link href="/account/orders/" className={styles.footerLink}>
              {t('common.footer.orders')}
            </Link>
            <Link href="/account/" className={styles.footerLink}>
              {t('common.tools.account')}
            </Link>
            <Link href="/cart/" className={styles.footerLink}>
              {t('common.tools.cart')}
            </Link>
            <Link href="/contact/" className={styles.footerLink}>
              {t('common.nav.contact')}
            </Link>
            <Link href="/help/" className={styles.footerLink}>
              {t('common.footer.faq')}
            </Link>
          </div>
          <nav className={styles.links} aria-label={t('common.footer.legal')}>
            <h2 className={styles.heading}>{t('common.footer.legal')}</h2>
            <Link href="/about/" className={styles.footerLink}>
              {t('common.nav.about')}
            </Link>
            <Link href="/policies/privacy/" className={styles.footerLink}>
              {t('common.footer.privacy')}
            </Link>
            <Link href="/policies/returns/" className={styles.footerLink}>
              {t('common.footer.returns')}
            </Link>
            <Link href="/policies/shipping/" className={styles.footerLink}>
              {t('common.footer.shipping')}
            </Link>
            <Link href="/policies/terms/" className={styles.footerLink}>
              {t('common.footer.terms')}
            </Link>
          </nav>
          {store.contactEmail || store.contactPhone ? (
            <div className={styles.links}>
              <h2 className={styles.heading}>{t('common.footer.touch')}</h2>
              {store.contactPhone ? <p className={styles.contact}>{store.contactPhone}</p> : null}
              {store.contactEmail ? <p className={styles.contact}>{store.contactEmail}</p> : null}
            </div>
          ) : null}
        </div>
        <div className={styles.base}>
          <p className={styles.copyright}>{t('common.footer.rights', { store: store.name })}</p>
          <ConsentSettingsButton t={t} className={styles.cookies} />
          <PoweredBy brand={poweredBy} t={t} className={styles.powered} />
        </div>
      </footer>
      {whatsapp ? (
        <Link href={whatsapp.url} className={styles.whatsapp}>
          <svg className={styles.whatsappIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.6-1.2A9 9 0 1012 3zm4.4 12.4c-.2.5-1.1 1-1.6 1-.4.1-.9.1-1.5-.1a13 13 0 01-1.4-.5 10.6 10.6 0 01-4-3.6 4.6 4.6 0 01-1-2.4c0-1.2.6-1.7.8-2 .2-.2.5-.3.6-.3h.5c.1 0 .4 0 .6.4l.8 1.9c.1.1.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 1.9 1 .9 1.9 1.2 2.2 1.3.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.8.9c.3.1.4.2.5.3.1.2.1.7-.1 1.3z" />
          </svg>
          <span className={styles.hidden}>{t('common.footer.whatsapp')}</span>
        </Link>
      ) : null}
      <ConsentBanner t={t} className={styles.consent} />
    </div>
  )
}
