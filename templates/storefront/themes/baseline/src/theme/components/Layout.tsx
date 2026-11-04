import type { ReactNode } from 'react'
import { ConsentBanner, ConsentSettingsButton, Link, PoweredBy, PreviewBanner, StoreLogo, useCart, useMenu, useStorefront, useWishlist } from '@dripfunnel/storefront-core/theme'
import { Menu } from './interactive/Menu'
import { NavItem } from './interactive/NavItem'

export const Layout = ({ children }: { children: ReactNode }) => {
  const { store, t, mode, poweredBy } = useStorefront()
  const menu = useMenu()
  const { count } = useCart()
  const { count: wished } = useWishlist()
  return (
    <div className="-m-2 [--df-sealed-font:var(--font-body)] [--df-sealed-color:var(--color-ink)] [--df-sealed-muted:var(--color-muted)] [--df-sealed-surface:var(--color-surface)] [--df-sealed-radius:var(--radius-card)] flex min-h-[100vh] flex-col bg-bg text-ink font-body text-[15px] leading-[1.55]">
      {mode === 'live' ? null : <PreviewBanner t={t} className="block" />}
      <header className="border-b border-b-line sticky top-0 z-20 bg-header-bg text-header-ink">
        <div className="flex box-border w-[min(100%,1240px)] min-h-16 flex-wrap items-center gap-y-1 gap-x-2 mx-auto px-4 min-[900px]:flex-nowrap min-[900px]:gap-y-6 min-[900px]:gap-x-6 min-[900px]:px-8">
          <Link href="/" className="min-w-0 flex-[1_1_0] overflow-hidden text-header-ink font-heading text-[21px] font-[var(--brand-weight)] tracking-[var(--heading-spacing)] no-underline text-ellipsis [text-transform:var(--heading-case)] whitespace-nowrap focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px] min-[900px]:flex-[0_1_auto]">
            <StoreLogo className="block w-auto max-w-full h-10 object-contain object-[left_center]" />
          </Link>
          <Menu label={t('common.nav.menu')}>
            <nav className="flex flex-col py-2 min-[900px]:flex-row min-[900px]:gap-y-1 min-[900px]:gap-x-1 min-[900px]:py-0" aria-label={t('common.nav.label')}>
              {menu.items.length ? (
                menu.items.map((item) => <NavItem key={item.id} item={item} />)
              ) : (
                <Link href="/collections/all/" className="py-0 px-3 flex min-h-11 items-center rounded-[8px] text-header-ink text-[15px] font-medium no-underline hover:bg-header-hover focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px]">
                  {t('common.nav.shop')}
                </Link>
              )}
              <Link href="/about/" className="py-0 px-3 flex min-h-11 items-center rounded-[8px] text-header-ink text-[15px] font-medium no-underline hover:bg-header-hover focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px]">
                {t('common.nav.about')}
              </Link>
              <Link href="/contact/" className="py-0 px-3 flex min-h-11 items-center rounded-[8px] text-header-ink text-[15px] font-medium no-underline hover:bg-header-hover focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px]">
                {t('common.nav.contact')}
              </Link>
            </nav>
          </Menu>
          <div className="flex items-center gap-y-0.5 gap-x-0.5 min-[900px]:ml-auto">
            <Link href="/search/" className="inline-flex w-11 h-11 items-center justify-center rounded-full text-header-ink hover:bg-header-hover relative focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px]">
              <svg className="w-5.5 h-5.5 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6] min-[900px]:group-[:nth-child(n)]/layout-subToggle:w-4 min-[900px]:group-[:nth-child(n)]/layout-subToggle:h-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M16 16l4.5 4.5" />
              </svg>
              <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{t('common.tools.search')}</span>
            </Link>
            <Link href="/account/" className="inline-flex w-11 h-11 items-center justify-center rounded-full text-header-ink hover:bg-header-hover relative focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px]">
              <svg className="w-5.5 h-5.5 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6] min-[900px]:group-[:nth-child(n)]/layout-subToggle:w-4 min-[900px]:group-[:nth-child(n)]/layout-subToggle:h-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="8.5" r="3.8" />
                <path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" />
              </svg>
              <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{t('common.tools.account')}</span>
            </Link>
            <Link href="/account/wishlist/" className="inline-flex w-11 h-11 items-center justify-center rounded-full text-header-ink hover:bg-header-hover relative focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px]">
              <svg className="w-5.5 h-5.5 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6] min-[900px]:group-[:nth-child(n)]/layout-subToggle:w-4 min-[900px]:group-[:nth-child(n)]/layout-subToggle:h-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z" />
              </svg>
              <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{wished > 0 ? t('common.tools.wishlistCount', { count: wished }) : t('common.tools.wishlist')}</span>
              {wished > 0 ? (
                <span className="py-0 px-1.25 absolute top-1 right-0.5 inline-flex min-w-4.5 h-4.5 box-border items-center justify-center rounded-full bg-accent text-accent-ink text-[11px] font-bold leading-[1]" aria-hidden="true">
                  {wished}
                </span>
              ) : null}
            </Link>
            <Link href="/cart/" className="inline-flex w-11 h-11 items-center justify-center rounded-full text-header-ink hover:bg-header-hover relative focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px]">
              <svg className="w-5.5 h-5.5 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6] min-[900px]:group-[:nth-child(n)]/layout-subToggle:w-4 min-[900px]:group-[:nth-child(n)]/layout-subToggle:h-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5.5 8h13l-1 12h-11z" />
                <path d="M9 8V6.5a3 3 0 016 0V8" />
              </svg>
              <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{count > 0 ? t('common.tools.cartCount', { count }) : t('common.tools.cart')}</span>
              {count > 0 ? (
                <span className="py-0 px-1.25 absolute top-1 right-0.5 inline-flex min-w-4.5 h-4.5 box-border items-center justify-center rounded-full bg-accent text-accent-ink text-[11px] font-bold leading-[1]" aria-hidden="true">
                  {count}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
      </header>
      <main className="w-full flex-1">{children}</main>
      <footer className="pt-10 pr-4 pb-6 pl-4 mt-14 border-t border-t-footer-line bg-footer-bg text-footer-ink text-[14px] min-[900px]:px-8">
        <div className="grid box-border w-[min(100%,1208px)] gap-y-7 gap-x-5 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] mx-auto min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-y-1.5 gap-x-1.5 col-[1_/_-1] min-[900px]:col-[auto]">
            <p className="m-0 font-heading text-[18px] font-[var(--brand-weight)] wrap-anywhere [text-transform:var(--heading-case)]">{store.name}</p>
            <p className="m-0 max-w-[36ch] text-footer-muted">{store.tagline ?? t('common.footer.note')}</p>
            {store.contactEmail ? <p className="m-0 wrap-anywhere">{store.contactEmail}</p> : null}
            {store.contactPhone ? <p className="m-0 wrap-anywhere">{store.contactPhone}</p> : null}
            {store.social.length ? (
              <div className="flex flex-wrap gap-y-0 gap-x-4 capitalize">
                {store.social.map((s) => (
                  <Link key={s.network} href={s.url} className="flex min-h-9 items-center text-footer-ink no-underline hover:underline focus-visible:[outline:2px_solid_var(--color-footer-ink)] focus-visible:outline-offset-[2px]">
                    {s.network}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col">
            <h2 className="mt-0 mr-0 mb-1.5 ml-0 text-footer-muted text-[12px] font-semibold tracking-[0.12em] uppercase">{t('common.footer.shop')}</h2>
            <Link href="/collections/all/" className="flex min-h-9 items-center text-footer-ink no-underline hover:underline focus-visible:[outline:2px_solid_var(--color-footer-ink)] focus-visible:outline-offset-[2px]">
              {t('common.footer.all')}
            </Link>
            <Link href="/about/" className="flex min-h-9 items-center text-footer-ink no-underline hover:underline focus-visible:[outline:2px_solid_var(--color-footer-ink)] focus-visible:outline-offset-[2px]">
              {t('common.nav.about')}
            </Link>
            <Link href="/account/" className="flex min-h-9 items-center text-footer-ink no-underline hover:underline focus-visible:[outline:2px_solid_var(--color-footer-ink)] focus-visible:outline-offset-[2px]">
              {t('common.tools.account')}
            </Link>
          </div>
          <div className="flex min-w-0 flex-col">
            <h2 className="mt-0 mr-0 mb-1.5 ml-0 text-footer-muted text-[12px] font-semibold tracking-[0.12em] uppercase">{t('common.footer.help')}</h2>
            <Link href="/contact/" className="flex min-h-9 items-center text-footer-ink no-underline hover:underline focus-visible:[outline:2px_solid_var(--color-footer-ink)] focus-visible:outline-offset-[2px]">
              {t('common.nav.contact')}
            </Link>
            <Link href="/policies/shipping/" className="flex min-h-9 items-center text-footer-ink no-underline hover:underline focus-visible:[outline:2px_solid_var(--color-footer-ink)] focus-visible:outline-offset-[2px]">
              {t('common.footer.shipping')}
            </Link>
            <Link href="/policies/returns/" className="flex min-h-9 items-center text-footer-ink no-underline hover:underline focus-visible:[outline:2px_solid_var(--color-footer-ink)] focus-visible:outline-offset-[2px]">
              {t('common.footer.returns')}
            </Link>
          </div>
          <div className="flex min-w-0 flex-col">
            <h2 className="mt-0 mr-0 mb-1.5 ml-0 text-footer-muted text-[12px] font-semibold tracking-[0.12em] uppercase">{t('common.footer.legal')}</h2>
            <Link href="/policies/terms/" className="flex min-h-9 items-center text-footer-ink no-underline hover:underline focus-visible:[outline:2px_solid_var(--color-footer-ink)] focus-visible:outline-offset-[2px]">
              {t('common.footer.terms')}
            </Link>
            <Link href="/policies/privacy/" className="flex min-h-9 items-center text-footer-ink no-underline hover:underline focus-visible:[outline:2px_solid_var(--color-footer-ink)] focus-visible:outline-offset-[2px]">
              {t('common.footer.privacy')}
            </Link>
            <Link href="/policies/legal/" className="flex min-h-9 items-center text-footer-ink no-underline hover:underline focus-visible:[outline:2px_solid_var(--color-footer-ink)] focus-visible:outline-offset-[2px]">
              {t('common.footer.notice')}
            </Link>
          </div>
        </div>
        <div className="pt-4.5 mt-7 mr-auto mb-0 ml-auto border-t border-t-footer-line flex box-border w-[min(100%,1208px)] flex-wrap items-center justify-between gap-y-3 gap-x-3 text-footer-muted">
          <ConsentSettingsButton t={t} className="block [--df-sealed-color:var(--color-footer-ink)] [&::part(button)]:py-0 [&::part(button)]:px-3.5 [&::part(button)]:border [&::part(button)]:border-footer-line [&::part(button)]:min-h-11 [&::part(button)]:rounded-button [&::part(button)]:bg-transparent [&::part(button)]:text-footer-ink" />
          <PoweredBy brand={poweredBy} t={t} className="block [--df-sealed-muted:var(--color-footer-muted)]" />
        </div>
      </footer>
      <ConsentBanner t={t} className="block" />
    </div>
  )
}
