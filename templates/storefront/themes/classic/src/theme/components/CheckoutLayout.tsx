import type { ReactNode } from 'react'
import { ConsentBanner, ConsentSettingsButton, Link, PoweredBy, PreviewBanner, StoreLogo, useStorefront } from '@dripfunnel/storefront-core/theme'

/** Checkout's own frame (D1): the shop's logo or name, "Secure checkout" and the way back to the cart, without the menu. */
export const CheckoutLayout = ({ children }: { children: ReactNode }) => {
  const { t, mode, poweredBy } = useStorefront()
  return (
    <div className="-m-2 [--df-sealed-font:var(--font-body)] [--df-sealed-color:var(--color-ink)] [--df-sealed-muted:var(--color-muted)] [--df-sealed-surface:var(--color-surface)] [--df-sealed-radius:var(--radius-card)] flex min-h-[100vh] flex-col bg-bg text-ink font-body text-[15px] leading-[1.55]">
      {mode === 'live' ? null : <PreviewBanner t={t} className="block" />}
      <header className="bg-header-bg text-header-ink">
        <div className="flex box-border w-[min(100%,1240px)] min-h-16 items-center justify-between gap-y-2 gap-x-4 mx-auto px-4">
          <Link href="/" className="min-w-0 overflow-hidden text-header-ink font-heading text-[24px] font-[var(--brand-weight)] leading-[1.1] no-underline text-ellipsis whitespace-nowrap focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px] min-[900px]:text-[28px]">
            <StoreLogo className="block w-auto max-w-full h-10 object-contain object-[left_center]" />
          </Link>
          <p className="m-0 inline-flex items-center gap-y-1.5 gap-x-1.5 text-header-ink text-[14px]">
            <svg className="w-4 h-4 [fill:none] [stroke:currentcolor] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect x="5" y="10.5" width="14" height="10" rx="2" />
              <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
            </svg>
            {t('shop.checkout.secure')}
          </p>
          <Link href="/cart/" className="underline-offset-[3px] shrink-0 text-header-ink text-[14px]">
            {t('shop.checkout.backToCart')}
          </Link>
        </div>
      </header>
      <main className="w-full flex-1">{children}</main>
      <footer className="pt-5 pr-4 pb-6 pl-4 mt-10 mr-auto mb-0 ml-auto border-t border-t-line flex box-border w-[min(100%,1240px)] flex-wrap items-center justify-between gap-y-3 gap-x-3">
        <ConsentSettingsButton t={t} className="block [&::part(button)]:py-0 [&::part(button)]:px-3.5 [&::part(button)]:border [&::part(button)]:border-line [&::part(button)]:min-h-10 [&::part(button)]:rounded-button [&::part(button)]:bg-transparent [&::part(button)]:text-ink" />
        <PoweredBy brand={poweredBy} t={t} className="block" />
      </footer>
      <ConsentBanner t={t} className="block" />
    </div>
  )
}
