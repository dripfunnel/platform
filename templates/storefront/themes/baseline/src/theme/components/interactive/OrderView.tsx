'use client'

import { Link, OrderSummary, PaymentElement, useOrder, useStorefront } from '@dripfunnel/storefront-core/theme'
import { DeliveryTracking } from '../DeliveryTracking'
import { Notice } from '../Notice'
import { OrderPill } from '../OrderPill'
import { PaymentMethod } from '../PaymentMethod'
import { Retry } from './Retry'

/**
 * The order's page (`/order/{id}/`), as D1's order confirmation: where it stands, what to do next, and what was charged;
 * `inAccount`, the same order in the account (`/account/orders/{id}/`), headed by its number.
 */
export const OrderView = ({ inAccount = false }: { inAccount?: boolean }) => {
  const { locale, t } = useStorefront()
  const page = useOrder()

  if (page.status === 'loading') {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8" aria-busy="true">
        <h1 className="m-0 max-w-[24ch] font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[36px]">{t('shop.order.loading')}</h1>
      </section>
    )
  }
  if (page.status === 'error') {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('shop.order.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={page.retry} />
        </Notice>
      </section>
    )
  }
  const order = page.order
  if (!order) {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('shop.order.missing')} lead={t('shop.order.missingLead')}>
          <Link href="/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
            {t('shop.order.keepShopping')}
          </Link>
        </Notice>
      </section>
    )
  }
  const awaiting = !order.cancelled && order.payment === 'awaiting'
  return (
    <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
      <div className="grid gap-y-5 gap-x-5 items-start min-[900px]:grid-cols-[minmax(0,1fr)_400px] min-[900px]:gap-y-8 min-[900px]:gap-x-8">
        <div className="flex min-w-0 flex-col gap-y-4.5 gap-x-4.5">
          <div className="flex flex-col gap-y-2 gap-x-2">
            {inAccount ? (
              <Link href="/account/" className="self-start text-ink-soft text-[14px]">
                {t('shop.order.backToAccount')}
              </Link>
            ) : null}
            <OrderPill order={order} />
            <h1 className="m-0 font-heading text-[32px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] [text-transform:var(--heading-case)]">{order.cancelled ? t('shop.order.cancelledTitle') : inAccount ? t('shop.order.summary', { number: order.number }) : t('shop.order.title')}</h1>
            {order.cancelled ? <p className="m-0 text-ink-soft">{t('shop.order.cancelledLead', { number: order.number })}</p> : inAccount ? null : <p className="m-0 text-ink-soft">{t('shop.order.lead', { number: order.number })}</p>}
          </div>
          {awaiting && order.method === 'bank_transfer' ? (
            <div className="p-4.5 border border-line flex flex-col gap-y-3 gap-x-3 rounded-card bg-surface">
              <h2 className="m-0 font-heading text-[20px] font-[var(--heading-weight)]">{t('shop.order.transferTitle')}</h2>
              <p className="m-0 text-ink-soft text-[14px]">{order.payBy ? t('shop.order.transferBy', { number: order.number, date: order.payBy }) : t('shop.order.transferRef', { number: order.number })}</p>
              {order.instructions ? <p className="m-0 text-[14px] wrap-anywhere whitespace-pre-line">{order.instructions}</p> : null}
            </div>
          ) : null}
          {awaiting && order.method === 'cod' ? <p className="py-3 px-3.5 m-0 border border-line flex flex-wrap items-center gap-y-3 gap-x-3 rounded-card bg-soft text-ink">{t('shop.order.cod')}</p> : null}
          {!order.cancelled && order.payment === 'confirming' ? (
            <div className="p-4.5 border border-line flex flex-col gap-y-3 gap-x-3 rounded-card bg-surface">
              <p className="m-0 text-ink-soft text-[14px]" role="status">
                {t('shop.order.confirming')}
              </p>
              <div className="flex flex-wrap gap-y-2.5 gap-x-2.5">
                <Retry label={t('shop.order.checkAgain')} onRetry={page.retry} />
                {page.payAgain ? (
                  <button type="button" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" onClick={page.payAgain}>
                    {t('shop.order.payAgain')}
                  </button>
                ) : null}
              </div>
              <PaymentElement t={t} />
            </div>
          ) : null}
          {!order.cancelled && order.tracking ? <DeliveryTracking tracking={order.tracking} /> : null}
          {order.downloads.length > 0 ? (
            <div className="p-4.5 border border-line flex flex-col gap-y-3 gap-x-3 rounded-card bg-surface">
              <h2 className="m-0 font-heading text-[20px] font-[var(--heading-weight)]">{t('shop.order.downloads')}</h2>
              <ul className="p-0 m-0 grid gap-y-3 gap-x-3 list-none">
                {order.downloads.map((d, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-y-2 gap-x-3.5">
                    {d.url ? (
                      <Link href={d.url} className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
                        {t('shop.order.download', { name: d.name })}
                      </Link>
                    ) : (
                      <span>{d.name}</span>
                    )}
                    {d.usesLeft !== null && d.until ? <span className="m-0 text-ink-soft text-[14px]">{t('shop.order.downloadLeft', { count: d.usesLeft, date: d.until })}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {order.licenceKeys.length > 0 ? (
            <div className="p-4.5 border border-line flex flex-col gap-y-3 gap-x-3 rounded-card bg-surface">
              <h2 className="m-0 font-heading text-[20px] font-[var(--heading-weight)]">{t('shop.order.keys')}</h2>
              <dl className="m-0 grid gap-y-2.5 gap-x-2.5 [&_div]:grid [&_div]:grid-cols-[120px_1fr] [&_div]:gap-y-3 [&_div]:gap-x-3 [&_dt]:text-muted [&_dt]:text-[14px] [&_dd]:m-0 [&_dd]:wrap-anywhere">
                {order.licenceKeys.map((k, i) => (
                  <div key={i}>
                    <dt>{k.name}</dt>
                    <dd className="font-[ui-monospace,'SFMono-Regular',Menlo,monospace] wrap-anywhere">{k.key}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {order.lines.flatMap((l, i) =>
            l.gift ? [
              <p key={i} className="py-3 px-3.5 m-0 border border-line flex flex-wrap items-center gap-y-3 gap-x-3 rounded-card bg-soft text-ink">
                {l.gift.sendOn ? t('shop.order.giftOn', { name: l.gift.recipientName, date: l.gift.sendOn }) : t('shop.order.giftNow', { name: l.gift.recipientName })}
              </p>,
            ] : [],
          )}
          <div className="p-4.5 border border-line flex flex-col gap-y-3 gap-x-3 rounded-card bg-surface">
            <dl className="m-0 grid gap-y-2.5 gap-x-2.5 [&_div]:grid [&_div]:grid-cols-[120px_1fr] [&_div]:gap-y-3 [&_div]:gap-x-3 [&_dt]:text-muted [&_dt]:text-[14px] [&_dd]:m-0 [&_dd]:wrap-anywhere">
              {order.delivery ? (
                <div>
                  <dt>{t('shop.order.method')}</dt>
                  <dd>{order.delivery}</dd>
                </div>
              ) : null}
              {order.method ? (
                <div>
                  <dt>{t('shop.checkout.payment')}</dt>
                  <dd>
                    <PaymentMethod provider={order.method} />
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
          <div className="flex flex-wrap gap-y-2.5 gap-x-2.5">
            <Link href="/" className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
              {t('shop.order.keepShopping')}
            </Link>
          </div>
        </div>
        <aside className="p-5 border border-line flex flex-col gap-y-3.5 gap-x-3.5 rounded-card bg-surface min-[900px]:sticky min-[900px]:top-24">
          <h2 className="m-0 font-heading text-[20px] font-[var(--heading-weight)]">{inAccount ? t('shop.checkout.summary') : t('shop.order.summary', { number: order.number })}</h2>
          <OrderSummary order={order} locale={locale} t={t} className="[--df-sealed-size:15px] [--df-sealed-saving:var(--color-accent)]" />
        </aside>
      </div>
    </section>
  )
}
