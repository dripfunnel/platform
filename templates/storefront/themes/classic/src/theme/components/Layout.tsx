import type { ReactNode } from 'react'
import { ConsentBanner, ConsentSettingsButton, Link, navigate, PoweredBy, PreviewBanner, SearchField, StoreLogo, useCart, useCollections, useMenu, useStorefront, useWishlist } from '@dripfunnel/storefront-core/theme'
import { Menu } from './interactive/Menu'
import { NavItem } from './interactive/NavItem'

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
    <div className="-m-2 [--df-sealed-font:var(--font-body)] [--df-sealed-color:var(--color-ink)] [--df-sealed-muted:var(--color-muted)] [--df-sealed-surface:var(--color-surface)] [--df-sealed-radius:var(--radius-card)] flex min-h-[100vh] flex-col bg-bg text-ink font-body text-[15px] leading-[1.55]">
      {mode === 'live' ? null : <PreviewBanner t={t} className="block" />}
      <header className="bg-header-bg text-header-ink">
        <div className="py-2.5 px-4 grid box-border w-[min(100%,1240px)] items-center gap-y-2 gap-x-3 grid-cols-[minmax(0,1fr)_auto] mx-auto min-[900px]:py-3 min-[900px]:px-8 min-[900px]:min-h-18 min-[900px]:gap-y-6 min-[900px]:gap-x-6 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,560px)_minmax(0,1fr)]">
          <Link href="/" className="min-w-0 overflow-hidden text-header-ink font-heading text-[24px] font-[var(--brand-weight)] leading-[1.1] no-underline text-ellipsis whitespace-nowrap focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px] min-[900px]:text-[28px]">
            <StoreLogo className="block w-auto max-w-full h-10 object-contain object-[left_center]" />
          </Link>
          <SearchField label={t('common.tools.search')} placeholder={t('common.tools.searchPrompt')} button={t('common.tools.search')} value="" onSearch={searchFor} suggest={4} className={`pt-1 pr-1 pb-1 pl-4.5 relative flex min-h-11 box-border items-center gap-y-3 gap-x-3 col-[1_/_-1] [order:1] rounded-full bg-bg text-muted text-[14px] [&_label]:absolute [&_label]:overflow-hidden [&_label]:w-px [&_label]:h-px [&_label]:[clip-path:inset(50%)] [&_label]:whitespace-nowrap [&_input]:p-0 [&_input]:border-0 [&_input]:border-current [&_input]:min-w-0 [&_input]:flex-1 [&_input]:bg-transparent [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit] [&_input]:[outline:none] [&_input::placeholder]:text-muted [&_button]:p-0 [&_button]:border-0 [&_button]:border-current [&_button]:relative [&_button]:w-9 [&_button]:h-9 [&_button]:shrink-0 [&_button]:rounded-full [&_button]:bg-taupe [&_button]:text-transparent [&_button]:text-[0] [&_button]:cursor-pointer [&_button::before]:border-[2px] [&_button::before]:border-taupe-ink [&_button::before]:absolute [&_button::before]:top-2.5 [&_button::before]:left-2.5 [&_button::before]:w-2.75 [&_button::before]:h-2.75 [&_button::before]:box-border [&_button::before]:rounded-[50%] [&_button::before]:[content:''] [&_button::after]:absolute [&_button::after]:top-5.5 [&_button::after]:left-5 [&_button::after]:w-1.5 [&_button::after]:h-0.5 [&_button::after]:bg-taupe-ink [&_button::after]:[content:''] [&_button::after]:[transform:rotate(45deg)] [&_button::after]:[transform-origin:0_50%] [&_ul]:p-1.5 [&_ul]:m-0 [&_ul]:border [&_ul]:border-line [&_ul]:absolute [&_ul]:z-30 [&_ul]:top-[calc(100%_+_8px)] [&_ul]:right-0 [&_ul]:left-0 [&_ul]:rounded-card [&_ul]:bg-surface [&_ul]:[box-shadow:0_16px_40px_rgb(38_34_31_/_18%)] [&_ul]:list-none [&_li]:rounded-[6px] [&_li]:text-ink [&_li]:cursor-pointer [&_li:hover]:bg-soft [&_li[aria-selected="true"]]:bg-soft [&_li:last-child]:py-2.5 [&_li:last-child]:px-3 [&_li:last-child]:border-t [&_li:last-child]:border-t-line [&_li:last-child]:[border-radius:0_0_6px_6px] [&_li:last-child]:text-accent [&_li:last-child]:font-semibold [&_li_a]:py-2 [&_li_a]:px-3 [&_li_a]:flex [&_li_a]:items-center [&_li_a]:gap-y-3 [&_li_a]:gap-x-3 [&_li_a]:text-ink [&_li_a]:no-underline [&_li_img]:w-11 [&_li_img]:h-11 [&_li_img]:shrink-0 [&_li_img]:rounded-[6px] [&_li_img]:bg-soft [&_li_img]:object-cover [&_li_span]:flex-1 [&_li_span]:font-heading [&_li_span]:text-[16px] [&_li_span]:font-semibold [&_p]:py-3.5 [&_p]:px-4 [&_p]:m-0 [&_p]:border [&_p]:border-line [&_p]:absolute [&_p]:z-30 [&_p]:top-[calc(100%_+_8px)] [&_p]:right-0 [&_p]:left-0 [&_p]:rounded-card [&_p]:bg-surface [&_p]:[box-shadow:0_16px_40px_rgb(38_34_31_/_18%)] [&_p]:text-muted [&_p:empty]:p-0 [&_p:empty]:border-0 [&_p:empty]:border-current [&_p:empty]:shadow-none focus-within:[outline:2px_solid_var(--color-header-ink)] focus-within:outline-offset-[2px] min-[900px]:col-[auto] min-[900px]:[order:0]`} />
          <div className="flex items-center gap-y-1 gap-x-1 min-[900px]:justify-end">
            <Link href="/account/" className="inline-flex min-w-11 h-11 box-border items-center justify-center gap-y-2 gap-x-2 rounded-button text-header-ink text-[14px] font-semibold no-underline hover:bg-header-hover focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px] min-[900px]:py-0 min-[900px]:px-2.5">
              <svg className="w-5.5 h-5.5 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6] min-[900px]:group-[:nth-child(n)]/layout-subToggle:w-3.5 min-[900px]:group-[:nth-child(n)]/layout-subToggle:h-3.5" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="8.5" r="3.8" />
                <path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" />
              </svg>
              <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap min-[900px]:static min-[900px]:w-auto min-[900px]:h-auto min-[900px]:[clip-path:none]">{t('common.tools.account')}</span>
            </Link>
            <span className="hidden w-px h-6 bg-[rgb(255_255_255_/_25%)] min-[900px]:block" aria-hidden="true" />
            <Link href="/account/wishlist/" className="inline-flex min-w-11 h-11 box-border items-center justify-center gap-y-2 gap-x-2 rounded-button text-header-ink text-[14px] font-semibold no-underline hover:bg-header-hover relative focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px]">
              <svg className="w-5.5 h-5.5 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6] min-[900px]:group-[:nth-child(n)]/layout-subToggle:w-3.5 min-[900px]:group-[:nth-child(n)]/layout-subToggle:h-3.5" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z" />
              </svg>
              <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{wished > 0 ? t('common.tools.wishlistCount', { count: wished }) : t('common.tools.wishlist')}</span>
              {wished > 0 ? (
                <span className="py-0 px-1.25 absolute top-0.5 right-0 inline-flex min-w-4.5 h-4.5 box-border items-center justify-center rounded-full bg-taupe text-taupe-ink text-[11px] font-bold leading-[1]" aria-hidden="true">
                  {wished}
                </span>
              ) : null}
            </Link>
            <Link href="/cart/" className="inline-flex min-w-11 h-11 box-border items-center justify-center gap-y-2 gap-x-2 rounded-button text-header-ink text-[14px] font-semibold no-underline hover:bg-header-hover relative focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px]">
              <svg className="w-5.5 h-5.5 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6] min-[900px]:group-[:nth-child(n)]/layout-subToggle:w-3.5 min-[900px]:group-[:nth-child(n)]/layout-subToggle:h-3.5" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5.5 8h13l-1 12h-11z" />
                <path d="M9 8V6.5a3 3 0 016 0V8" />
              </svg>
              <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{count > 0 ? t('common.tools.cartCount', { count }) : t('common.tools.cart')}</span>
              {count > 0 ? (
                <span className="py-0 px-1.25 absolute top-0.5 right-0 inline-flex min-w-4.5 h-4.5 box-border items-center justify-center rounded-full bg-taupe text-taupe-ink text-[11px] font-bold leading-[1]" aria-hidden="true">
                  {count}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
      </header>
      <div className="border-b border-b-[rgb(179_165_147_/_30%)] sticky top-0 z-20 bg-nav-bg [backdrop-filter:blur(8px)] text-ink">
        <div className="flex box-border w-[min(100%,1240px)] min-h-13 flex-wrap items-center mx-auto px-4 min-[900px]:justify-center min-[900px]:px-8">
          <Menu label={t('common.nav.menu')}>
            <nav className="flex flex-col py-2 min-[900px]:flex-row min-[900px]:gap-y-1 min-[900px]:gap-x-1 min-[900px]:py-0" aria-label={t('common.nav.label')}>
              <Link href="/" className="py-0 px-3 flex min-h-11 items-center rounded-button text-ink text-[13px] font-semibold tracking-[0.06em] no-underline uppercase hover:text-accent hover:underline hover:underline-offset-[4px] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] min-[900px]:group-[:nth-child(n)]/layout-navItem:pr-0.5">
                {t('common.nav.home')}
              </Link>
              {menu.items.length ? (
                menu.items.map((item) => <NavItem key={item.id} item={item} />)
              ) : (
                <>
                  <Link href="/collections/all/" className="py-0 px-3 flex min-h-11 items-center rounded-button text-ink text-[13px] font-semibold tracking-[0.06em] no-underline uppercase hover:text-accent hover:underline hover:underline-offset-[4px] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] min-[900px]:group-[:nth-child(n)]/layout-navItem:pr-0.5">
                    {t('common.nav.shopAll')}
                  </Link>
                  {collections.map((c) => (
                    <Link key={c.id} href={c.href} className="py-0 px-3 flex min-h-11 items-center rounded-button text-ink text-[13px] font-semibold tracking-[0.06em] no-underline uppercase hover:text-accent hover:underline hover:underline-offset-[4px] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] min-[900px]:group-[:nth-child(n)]/layout-navItem:pr-0.5">
                      {c.name}
                    </Link>
                  ))}
                  <Link href="/about/" className="py-0 px-3 flex min-h-11 items-center rounded-button text-ink text-[13px] font-semibold tracking-[0.06em] no-underline uppercase hover:text-accent hover:underline hover:underline-offset-[4px] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] min-[900px]:group-[:nth-child(n)]/layout-navItem:pr-0.5">
                    {t('common.nav.about')}
                  </Link>
                  <Link href="/contact/" className="py-0 px-3 flex min-h-11 items-center rounded-button text-ink text-[13px] font-semibold tracking-[0.06em] no-underline uppercase hover:text-accent hover:underline hover:underline-offset-[4px] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] min-[900px]:group-[:nth-child(n)]/layout-navItem:pr-0.5">
                    {t('common.nav.contact')}
                  </Link>
                </>
              )}
            </nav>
          </Menu>
          <ul className="py-1.5 px-1 m-0 flex min-w-0 flex-1 gap-y-1.5 gap-x-1.5 list-none [order:2] overflow-x-auto [overscroll-behavior-x:contain] [scroll-snap-type:x_proximity] [scrollbar-width:none] [&_li]:shrink-0 [&_li]:[scroll-snap-align:start] min-[900px]:hidden">
            <li>
              <Link href="/collections/all/" className="py-0 px-3 border border-[rgb(179_165_147_/_40%)] inline-flex h-8 box-border items-center rounded-full bg-[rgb(250_249_247_/_60%)] text-ink text-[11px] font-semibold tracking-[0.08em] no-underline uppercase whitespace-nowrap hover:border-accent hover:text-accent focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
                {t('common.nav.shopAll')}
              </Link>
            </li>
            {collections.map((c) => (
              <li key={c.id}>
                <Link href={c.href} className="py-0 px-3 border border-[rgb(179_165_147_/_40%)] inline-flex h-8 box-border items-center rounded-full bg-[rgb(250_249_247_/_60%)] text-ink text-[11px] font-semibold tracking-[0.08em] no-underline uppercase whitespace-nowrap hover:border-accent hover:text-accent focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <main className="w-full flex-1">{children}</main>
      <footer className="pt-11 pr-4 pb-6 pl-4 [background:linear-gradient(90deg,transparent,var(--color-taupe),transparent)_top_/_100%_3px_no-repeat,var(--color-footer-bg)] text-footer-muted text-[14px] min-[900px]:pt-14 min-[900px]:pr-8 min-[900px]:pb-6 min-[900px]:pl-8">
        <div className="grid box-border w-[min(100%,1208px)] gap-y-8 gap-x-5 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] mx-auto min-[900px]:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
          <div className="flex min-w-0 flex-col gap-y-2.5 gap-x-2.5 col-[1_/_-1] min-[900px]:col-[auto]">
            <p className="m-0 text-footer-ink font-heading text-[28px] font-[var(--brand-weight)] leading-[1.1] wrap-anywhere">{store.name}</p>
            {store.tagline ? <p className="m-0 text-taupe text-[12px] tracking-[0.2em] uppercase">{store.tagline}</p> : null}
            <p className="m-0 max-w-[36ch] wrap-anywhere">{store.description || t('common.footer.note')}</p>
            {store.social.length ? (
              <div className="mt-2 flex flex-wrap gap-y-2 gap-x-2">
                {store.social.map((s) => (
                  <Link key={s.network} href={s.url} className="py-0 px-3.5 border border-taupe inline-flex min-h-9 items-center rounded-full text-taupe text-[13px] no-underline capitalize hover:bg-taupe hover:text-taupe-ink focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
                    {s.network}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col">
            <h2 className="mt-0 mr-0 mb-3 ml-0 text-taupe font-heading text-[19px] font-[var(--heading-weight)]">{t('common.footer.shop')}</h2>
            {menu.items.length ? (
              menu.items.map((item) => (
                <Link key={item.id} href={item.href} className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
                  {item.label}
                </Link>
              ))
            ) : (
              <Link href="/collections/all/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
                {t('common.footer.all')}
              </Link>
            )}
          </div>
          <div className="flex min-w-0 flex-col">
            <h2 className="mt-0 mr-0 mb-3 ml-0 text-taupe font-heading text-[19px] font-[var(--heading-weight)]">{t('common.footer.help')}</h2>
            <Link href="/collections/all/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
              {t('common.footer.all')}
            </Link>
            <Link href="/account/orders/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
              {t('common.footer.orders')}
            </Link>
            <Link href="/account/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
              {t('common.tools.account')}
            </Link>
            <Link href="/cart/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
              {t('common.tools.cart')}
            </Link>
            <Link href="/contact/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
              {t('common.nav.contact')}
            </Link>
            <Link href="/help/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
              {t('common.footer.faq')}
            </Link>
          </div>
          <nav className="flex min-w-0 flex-col" aria-label={t('common.footer.legal')}>
            <h2 className="mt-0 mr-0 mb-3 ml-0 text-taupe font-heading text-[19px] font-[var(--heading-weight)]">{t('common.footer.legal')}</h2>
            <Link href="/about/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
              {t('common.nav.about')}
            </Link>
            <Link href="/policies/privacy/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
              {t('common.footer.privacy')}
            </Link>
            <Link href="/policies/returns/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
              {t('common.footer.returns')}
            </Link>
            <Link href="/policies/shipping/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
              {t('common.footer.shipping')}
            </Link>
            <Link href="/policies/terms/" className="flex min-h-8.5 items-center text-footer-muted no-underline hover:text-taupe focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]">
              {t('common.footer.terms')}
            </Link>
          </nav>
          {store.contactEmail || store.contactPhone ? (
            <div className="flex min-w-0 flex-col">
              <h2 className="mt-0 mr-0 mb-3 ml-0 text-taupe font-heading text-[19px] font-[var(--heading-weight)]">{t('common.footer.touch')}</h2>
              {store.contactPhone ? <p className="mt-0 mr-0 mb-2.5 ml-0 wrap-anywhere">{store.contactPhone}</p> : null}
              {store.contactEmail ? <p className="mt-0 mr-0 mb-2.5 ml-0 wrap-anywhere">{store.contactEmail}</p> : null}
            </div>
          ) : null}
        </div>
        <div className="pt-4.5 mt-8 mr-auto mb-0 ml-auto border-t border-t-footer-line flex box-border w-[min(100%,1208px)] flex-wrap items-center justify-between gap-y-3 gap-x-3 text-footer-muted text-[12px]">
          <p className="mt-0 mr-auto mb-0 ml-0">{t('common.footer.rights', { store: store.name })}</p>
          <ConsentSettingsButton t={t} className="block [--df-sealed-color:var(--color-footer-ink)] [&::part(button)]:py-0 [&::part(button)]:px-3.5 [&::part(button)]:border [&::part(button)]:border-footer-line [&::part(button)]:min-h-10 [&::part(button)]:rounded-button [&::part(button)]:bg-transparent [&::part(button)]:text-footer-ink" />
          <PoweredBy brand={poweredBy} t={t} className="block [--df-sealed-muted:var(--color-footer-muted)]" />
        </div>
      </footer>
      {whatsapp ? (
        <Link href={whatsapp.url} className="fixed z-30 right-5 bottom-5 flex w-14 h-14 items-center justify-center rounded-full bg-accent [box-shadow:0_0_0_8px_rgb(38_34_31_/_15%),0_8px_24px_rgb(0_0_0_/_20%)] text-[#fff] [transition:transform_0.3s_ease] hover:[transform:scale(1.06)] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
          <svg className="w-7 h-7 [fill:currentcolor]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.6-1.2A9 9 0 1012 3zm4.4 12.4c-.2.5-1.1 1-1.6 1-.4.1-.9.1-1.5-.1a13 13 0 01-1.4-.5 10.6 10.6 0 01-4-3.6 4.6 4.6 0 01-1-2.4c0-1.2.6-1.7.8-2 .2-.2.5-.3.6-.3h.5c.1 0 .4 0 .6.4l.8 1.9c.1.1.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 1.9 1 .9 1.9 1.2 2.2 1.3.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.8.9c.3.1.4.2.5.3.1.2.1.7-.1 1.3z" />
          </svg>
          <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{t('common.footer.whatsapp')}</span>
        </Link>
      ) : null}
      <ConsentBanner t={t} className="block" />
    </div>
  )
}
