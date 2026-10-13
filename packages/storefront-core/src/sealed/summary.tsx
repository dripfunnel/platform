'use client'

import type { Cart } from '../cart/cart'
import type { Translate } from '../platform/i18n/i18n'
import { formatMoney, type Money } from '../pricing/money'
import { Sealed } from './Sealed'

// The order summary (storefront ARCHITECTURE §2.1 `sealed`, §3.3): every amount as the engine answered it, worded by core,
// and a note while a change awaits its answer. Parts: panel, lines, line, photo, name, version, rows, row, saving, total, note.

export type OrderSummaryProps = {
  cart: Cart
  /** `checkout` lists the lines and says delivery is the next step; `cart` leaves the lines to the page. */
  at: 'cart' | 'checkout'
  locale: string
  t: Translate
  className?: string
}

const isZero = (m: Money) => /^-?0+$/.test(m.amount)

export const OrderSummary = ({ cart, at, locale, t, className }: OrderSummaryProps) => {
  const money = (m: Money) => formatMoney(m, locale)
  const delivery = cart.shipping ? (isZero(cart.shipping) ? t('summary.free') : money(cart.shipping)) : cart.needsShipping ? t(at === 'cart' ? 'summary.deliveryAtCheckout' : 'summary.deliveryNext') : null
  return (
    <Sealed part="summary" className={className}>
      <section part="panel" aria-label={t('summary.label')} aria-busy={cart.pending || undefined}>
        {at === 'checkout' ? (
          <ul part="lines">
            {cart.lines.map((l) => (
              <li key={l.versionId} part="line">
                {l.photo ? <img part="photo" src={l.photo.url} alt="" width={56} height={70} loading="lazy" decoding="async" /> : <span />}
                <span>
                  <span part="name">{t('summary.quantity', { name: l.name, quantity: l.quantity })}</span>
                  {l.versionName ? <span part="version"> {l.versionName}</span> : null}
                </span>
                <span>{l.lineTotal ? money(l.lineTotal) : null}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <dl part="rows">
          <div part="row">
            <dt>{t('summary.subtotal')}</dt>
            <dd>{money(cart.subtotal)}</dd>
          </div>
          {cart.discounts.map((d, i) => (
            <div key={i} part="row saving">
              <dt>{d.name}</dt>
              <dd>{t('summary.minus', { amount: money(d.amount) })}</dd>
            </div>
          ))}
          {delivery ? (
            <div part="row">
              <dt>{t('summary.delivery')}</dt>
              <dd>{delivery}</dd>
            </div>
          ) : null}
          {cart.tax && !cart.tax.includesTax ? (
            <div part="row">
              <dt>{t('summary.tax')}</dt>
              <dd>{money(cart.tax.amount)}</dd>
            </div>
          ) : null}
          <div part="total">
            <dt>{t(at === 'cart' ? 'summary.estimated' : 'summary.total')}</dt>
            <dd>{money(cart.total)}</dd>
          </div>
        </dl>
        {cart.tax?.includesTax && !isZero(cart.tax.amount) ? <p part="note">{t('summary.taxIncluded', { amount: money(cart.tax.amount) })}</p> : null}
        {cart.pending ? (
          <p part="note" role="status">
            {t('summary.updating')}
          </p>
        ) : null}
      </section>
    </Sealed>
  )
}
