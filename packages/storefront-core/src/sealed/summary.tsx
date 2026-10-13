'use client'

import type { Cart } from '../cart/cart'
import type { Order } from '../orders/order'
import type { Translate } from '../platform/i18n/i18n'
import { formatMoney, type Money } from '../pricing/money'
import { Sealed } from './Sealed'

// The order summary (storefront ARCHITECTURE §2.1 `sealed`, §3.3): every amount as the engine answered it, worded by core,
// and a note while a change awaits its answer. Parts: panel, lines, line, photo, name, version, rows, row, saving, total, note.

export type OrderSummaryProps = {
  locale: string
  t: Translate
  className?: string
} & (
  | {
      cart: Cart
      /** `checkout` lists the lines and says delivery is the next step; `cart` leaves the lines to the page. */
      at: 'cart' | 'checkout'
    }
  /** A placed order, on its own page: its lines and what was charged. */
  | { order: Order }
)

type Figures = {
  lines: { key: string; photo: string | null; name: string; quantity: number; versionName: string | null; lineTotal: Money | null }[] | null
  subtotal: Money
  discounts: { name: string; amount: Money }[]
  delivery: Money | 'later' | 'next' | null
  tax: { amount: Money; includesTax: boolean } | null
  total: Money
  /** A gift card's part of the total, and what is left after it. */
  giftCard: { applied: Money; last4: string | null; rest: Money } | null
  estimated: boolean
  pending: boolean
}

const isZero = (m: Money) => /^-?0+$/.test(m.amount)

const figuresOf = (props: OrderSummaryProps): Figures => {
  if ('order' in props) {
    const o = props.order
    const lines = o.lines.map((l, i) => ({ key: String(i), photo: null, name: l.name, quantity: l.quantity, versionName: l.versionName, lineTotal: l.lineTotal }))
    return { lines, subtotal: o.subtotal, discounts: o.discounts, delivery: o.shipping, tax: o.tax, total: o.total, giftCard: o.giftCard ? { applied: o.giftCard, last4: null, rest: { ...o.total, amount: String(BigInt(o.total.amount) - BigInt(o.giftCard.amount)) } as Money } : null, estimated: false, pending: false }
  }
  const { cart, at } = props
  const lines = at === 'checkout' ? cart.lines.map((l) => ({ key: l.versionId, photo: l.photo?.url ?? null, name: l.name, quantity: l.quantity, versionName: l.versionName, lineTotal: l.lineTotal })) : null
  const delivery = cart.shipping ?? (cart.needsShipping ? (at === 'cart' ? 'later' : 'next') : null)
  return { lines, subtotal: cart.subtotal, discounts: cart.discounts, delivery, tax: cart.tax, total: cart.total, giftCard: cart.giftCard ? { applied: cart.giftCard.applied, last4: cart.giftCard.last4, rest: cart.amountDue } : null, estimated: at === 'cart', pending: cart.pending }
}

export const OrderSummary = (props: OrderSummaryProps) => {
  const { locale, t, className } = props
  const f = figuresOf(props)
  const money = (m: Money) => formatMoney(m, locale)
  const delivery = f.delivery === 'later' ? t('summary.deliveryAtCheckout') : f.delivery === 'next' ? t('summary.deliveryNext') : f.delivery ? (isZero(f.delivery) ? t('summary.free') : money(f.delivery)) : null
  return (
    <Sealed part="summary" className={className}>
      <section part="panel" aria-label={t('summary.label')} aria-busy={f.pending || undefined}>
        {f.lines ? (
          <ul part="lines">
            {f.lines.map((l) => (
              <li key={l.key} part="line">
                {l.photo ? <img part="photo" src={l.photo} alt="" width={56} height={70} loading="lazy" decoding="async" /> : <span />}
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
            <dd>{money(f.subtotal)}</dd>
          </div>
          {f.discounts.map((d, i) => (
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
          {f.tax && !f.tax.includesTax ? (
            <div part="row">
              <dt>{t('summary.tax')}</dt>
              <dd>{money(f.tax.amount)}</dd>
            </div>
          ) : null}
          <div part="total">
            <dt>{t(f.estimated ? 'summary.estimated' : 'summary.total')}</dt>
            <dd>{money(f.total)}</dd>
          </div>
          {f.giftCard ? (
            <>
              <div part="row saving">
                <dt>{f.giftCard.last4 ? t('summary.giftCardEnding', { last4: f.giftCard.last4 }) : t('summary.giftCard')}</dt>
                <dd>{t('summary.minus', { amount: money(f.giftCard.applied) })}</dd>
              </div>
              <div part="total">
                <dt>{t('summary.afterGiftCard')}</dt>
                <dd>{money(f.giftCard.rest)}</dd>
              </div>
            </>
          ) : null}
        </dl>
        {f.tax?.includesTax && !isZero(f.tax.amount) ? <p part="note">{t('summary.taxIncluded', { amount: money(f.tax.amount) })}</p> : null}
        {f.pending ? (
          <p part="note" role="status">
            {t('summary.updating')}
          </p>
        ) : null}
      </section>
    </Sealed>
  )
}
