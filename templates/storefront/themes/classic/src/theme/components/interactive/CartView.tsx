'use client'

import { useState } from 'react'
import { clsx } from 'clsx'
import { CodeField, Image, Link, OrderSummary, Price, useCart, useStorefront, type CartLine } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { Retry } from './Retry'

const Minus = () => (
  <svg className="w-4 h-4 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-width:2]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 12h12" />
  </svg>
)
const Plus = () => (
  <svg className="w-4 h-4 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-width:2]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8" aria-busy="true">
        <h1 className="m-0 max-w-[24ch] font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[36px]">{t('shop.cart.title')}</h1>
        <p className="m-0 max-w-[60ch] text-muted text-[15px] wrap-anywhere">{t('shop.cart.loading')}</p>
      </section>
    )
  }
  if (page.status === 'error') {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('shop.cart.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={page.retry} />
        </Notice>
      </section>
    )
  }
  const cart = page.cart
  if (!cart || cart.lines.length === 0) {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('shop.cart.empty')} lead={t('shop.cart.emptyLead')}>
          <Link href="/collections/all/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
            {t('shop.cart.keepShopping')}
          </Link>
        </Notice>
      </section>
    )
  }
  const blocked = cart.lines.some((l) => l.problem !== null)
  return (
    <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
      <h1 className="m-0 max-w-[24ch] font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[36px]">{t('shop.cart.title')}</h1>
      {page.error ? (
        <p className="py-3 px-3.5 m-0 border border-line rounded-card bg-soft text-ink" role="alert">
          {t('shop.cart.changeFailed')}
        </p>
      ) : null}
      <div className="grid gap-y-5 gap-x-5 items-start min-[900px]:grid-cols-[minmax(0,1fr)_400px] min-[900px]:gap-y-8 min-[900px]:gap-x-8">
        <ul className="p-0 m-0 grid gap-y-3.5 gap-x-3.5 list-none">
          {cart.lines.map((line) => (
            <li key={line.versionId} className={clsx('p-3.5 border border-line grid grid-cols-[88px_1fr] gap-y-3.5 gap-x-3.5 rounded-card bg-surface', line.pending && 'opacity-[0.7] [transition:opacity_0.2s]')}>
              {line.photo ? <Image image={line.photo} alt={line.name} ratio={0.8} sizes="88px" className="w-22 h-27.5 rounded-[calc(var(--radius-card)_-_4px)] object-cover" /> : <span className="w-22 h-27.5 rounded-[calc(var(--radius-card)_-_4px)] [background:var(--picture-alt)]" />}
              <div className="flex min-w-0 flex-col gap-y-1.5 gap-x-1.5">
                <div className="flex justify-between gap-y-3 gap-x-3">
                  {line.href ? (
                    <Link href={line.href} className="m-0 text-ink font-semibold wrap-anywhere no-underline">
                      {line.name}
                    </Link>
                  ) : (
                    <p className="m-0 text-ink font-semibold wrap-anywhere no-underline">{line.name}</p>
                  )}
                  {line.lineTotal ? <Price money={line.lineTotal} includesTax={store.pricesIncludeTax} locale={locale} t={t} className="shrink-0 text-end" /> : null}
                </div>
                {line.versionName ? <p className="m-0 text-muted text-[14px]">{line.versionName}</p> : null}
                {line.gift ? <p className="m-0 text-muted text-[14px]">{t('shop.cart.giftFor', { name: line.gift.recipientName, email: line.gift.recipientEmail })}</p> : null}
                {problemWords(line) ? <p className="m-0 text-danger text-[14px]">{problemWords(line)}</p> : null}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-y-2.5 gap-x-2.5">
                  <div className="border border-line inline-flex items-center rounded-button" role="group" aria-label={t('shop.cart.quantity', { name: line.name })}>
                    <button type="button" className="border-0 border-current inline-flex w-11 h-11 items-center justify-center rounded-button bg-transparent text-ink cursor-pointer disabled:opacity-[0.4] disabled:cursor-default" aria-label={t('shop.cart.less')} disabled={line.quantity <= 1} onClick={() => void page.setQuantity(line.versionId, line.quantity - 1)}>
                      <Minus />
                    </button>
                    <span className="min-w-6 text-center [font-variant-numeric:tabular-nums]" aria-live="polite">
                      {line.quantity}
                    </span>
                    <button type="button" className="border-0 border-current inline-flex w-11 h-11 items-center justify-center rounded-button bg-transparent text-ink cursor-pointer disabled:opacity-[0.4] disabled:cursor-default" aria-label={t('shop.cart.more')} onClick={() => void page.setQuantity(line.versionId, line.quantity + 1)}>
                      <Plus />
                    </button>
                  </div>
                  <button type="button" className="py-0 px-1 border-0 border-current min-h-11 bg-transparent text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[14px] underline underline-offset-[3px] cursor-pointer" onClick={() => void page.remove(line.versionId)}>
                    {t('shop.cart.remove')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <aside className="p-5 border border-line flex flex-col gap-y-4 gap-x-4 rounded-card bg-surface min-[900px]:sticky min-[900px]:top-24">
          <h2 className="m-0 font-heading text-[22px] font-[var(--heading-weight)]">
            {t('shop.cart.summary')}
          </h2>
          <OrderSummary cart={cart} at="cart" locale={locale} t={t} className="[--df-sealed-size:15px] [--df-sealed-saving:var(--color-accent)]" />
          <CodeField
            label={t('shop.cart.code')}
            button={t('shop.cart.apply')}
            message={codeNote?.words ?? null}
            refused={codeNote?.refused ?? false}
            className="grid grid-cols-[1fr_auto] gap-y-2 gap-x-2 [&_label]:col-[1_/_-1] [&_label]:text-[14px] [&_label]:font-semibold [&_input]:py-0 [&_input]:px-3.5 [&_input]:border [&_input]:border-line [&_input]:min-h-12 [&_input]:box-border [&_input]:rounded-[calc(var(--radius-card)_-_4px)] [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit] [&_button]:py-0 [&_button]:px-5 [&_button]:border [&_button]:border-line [&_button]:min-h-12 [&_button]:rounded-button [&_button]:bg-surface [&_button]:text-ink [&_button]:[font-family:inherit] [&_button]:[font-size:inherit] [&_button]:[font-style:inherit] [&_button]:[line-height:inherit] [&_button]:font-semibold [&_button]:cursor-pointer [&_p]:m-0 [&_p]:col-[1_/_-1] [&_p]:text-ink-soft [&_p]:text-[14px]"
            onApply={async (code) => {
              const state = await page.applyCode(code)
              setCodeNote({ words: state ? codeWord(state) : t('shop.cart.changeFailed'), refused: state !== 'APPLIED' })
              return state === 'APPLIED'
            }}
          />
          {cart.codes.length ? (
            <ul className="p-0 m-0 flex flex-wrap gap-y-2 gap-x-2 list-none">
              {cart.codes.map((c) => (
                <li key={c.code} className="pt-0 pr-1 pb-0 pl-3 inline-flex items-center gap-y-2 gap-x-2 rounded-button bg-tint text-[14px] font-semibold">
                  <span>{c.code}</span>
                  <button type="button" className="py-0 px-1 border-0 border-current min-h-11 bg-transparent text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[14px] underline underline-offset-[3px] cursor-pointer" aria-label={t('shop.cart.removeCode', { code: c.code })} onClick={() => void page.removeCode(c.code)}>
                    {t('shop.cart.remove')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {blocked ? (
            <>
              <p className="m-0 text-danger text-[14px]">{t('shop.cart.blocked')}</p>
              <button type="button" className={clsx('py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]', 'self-stretch disabled:opacity-[0.55] disabled:cursor-default')} disabled>
                {t('shop.cart.checkout')}
              </button>
            </>
          ) : (
            <Link href="/checkout/" className={clsx('py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]', 'self-stretch disabled:opacity-[0.55] disabled:cursor-default')}>
              {t('shop.cart.checkout')}
            </Link>
          )}
        </aside>
      </div>
    </section>
  )
}
