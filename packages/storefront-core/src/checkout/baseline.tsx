'use client'

import { useState, type ReactNode } from 'react'
import { Link } from '../platform/browser/link'
import type { MessageKey } from '../platform/i18n/messages'
import { useStorefront } from '../platform/store/context'
import { formatMoney, isZero } from '../pricing/money'
import { PreviewBanner } from '../sealed/components'
import { PaymentElement } from '../sealed/payment'
import { OrderSummary } from '../sealed/summary'
import { AddressFields, Choices, Form, PhoneField, SubmitButton, TextField } from '../ui/headless/form'
import { addressDraft, useCheckout, type CheckoutStepId } from './checkout'
import type { AddressField, FieldProblem } from './address'
import { PlaceOrder } from './place'

// The baseline checkout (ARCHITECTURE §2.1 `checkout`, §3.3): core's own, in core's words and look, which a shopper gets for
// the rest of the visit once the theme's checkout throws (CheckoutBoundary). Its classes are core's, styled below.

const css = `
.df-bc{box-sizing:border-box;max-width:1080px;margin:0 auto;padding:16px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2933;line-height:1.5}
.df-bc *{box-sizing:border-box}
.df-bc-bar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding-bottom:12px;border-bottom:1px solid #d9dee3}
.df-bc-bar a{color:inherit}
.df-bc h1{font-size:28px;margin:16px 0}
.df-bc-grid{display:grid;gap:20px;align-items:start}
.df-bc-steps{display:grid;gap:12px;margin:0;padding:0;list-style:none}
.df-bc-step{padding:16px;border:1px solid #d9dee3;border-radius:10px;background:#fff}
.df-bc-step h2{font-size:18px;margin:0}
.df-bc-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.df-bc-line{margin:6px 0 0;color:#52606d;overflow-wrap:anywhere}
.df-bc form,.df-bc-fields{display:grid;gap:12px;margin-top:12px}
.df-bc label{display:grid;gap:4px;font-weight:600;font-size:14px}
.df-bc input,.df-bc select{min-height:44px;padding:0 12px;border:1px solid #9aa5b1;border-radius:8px;font:inherit;background:#fff;color:inherit}
.df-bc input[type=radio]{min-height:0;width:18px;height:18px}
.df-bc-phone{display:grid;grid-template-columns:6.5rem minmax(0,1fr);gap:8px}
.df-bc fieldset{display:grid;gap:8px;border:0;margin:0;padding:0}
.df-bc legend{font-weight:600;margin-bottom:8px}
.df-bc fieldset label{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid #d9dee3;border-radius:8px;font-weight:400}
.df-bc small{font-weight:400;color:#52606d}
.df-bc small[role=alert],.df-bc-alert{color:#a61b1b}
.df-bc-alert{margin:0 0 12px;padding:10px 12px;border:1px solid currentColor;border-radius:8px}
.df-bc button{min-height:44px;padding:0 18px;border-radius:8px;border:1px solid #1f2933;background:#1f2933;color:#fff;font:inherit;cursor:pointer;justify-self:start}
.df-bc button:disabled{opacity:.55;cursor:default}
.df-bc-change{background:transparent!important;color:#1f2933!important;border:0!important;text-decoration:underline;padding:0 4px!important}
.df-bc :focus-visible{outline:2px solid #0b5cad;outline-offset:2px}
.df-bc-side{padding:16px;border:1px solid #d9dee3;border-radius:10px;background:#fff}
@media (min-width:900px){.df-bc-grid{grid-template-columns:minmax(0,1fr) 360px}}
`

let styled = false
const style = () => {
  if (styled || typeof document === 'undefined' || typeof CSSStyleSheet !== 'function') return
  styled = true
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
}

const stepWord: Record<CheckoutStepId, MessageKey> = { contact: 'checkout.contact', address: 'checkout.address', delivery: 'checkout.delivery', payment: 'checkout.payment', review: 'checkout.review' }
const methodWord = (provider: string): MessageKey =>
  provider === 'cod' ? 'checkout.method.cod' : provider === 'bank_transfer' ? 'checkout.method.transfer' : provider === 'razorpay' || provider === 'cashfree' ? 'checkout.method.upi' : provider === 'phonepe' ? 'checkout.method.phonepe' : provider === 'paypal' ? 'checkout.method.paypal' : 'checkout.method.card'
const refusalWord = (code: string): MessageKey =>
  code === 'OUT_OF_STOCK' ? 'checkout.refused.outOfStock' : code === 'PHONE_REQUIRED' ? 'checkout.refused.phone' : code === 'NOT_READY' ? 'checkout.refused.notReady' : code === 'CART_CHANGED' ? 'checkout.refused.changed' : 'checkout.refused.other'

export const BaselineCheckout = () => {
  style()
  const { store, locale, t, mode } = useStorefront()
  const c = useCheckout()
  const [contact, setContact] = useState<{ email: string; phone: string } | null>(null)
  const [contactErrors, setContactErrors] = useState<Partial<Record<'email' | 'phone', FieldProblem>>>({})
  const [address, setAddress] = useState<ReturnType<typeof addressDraft> | null>(null)
  const [addressErrors, setAddressErrors] = useState<Partial<Record<AddressField, FieldProblem>>>({})
  const problem = (p: FieldProblem | undefined) => (p === 'required' ? t('address.required') : p === 'invalid' ? t('address.invalid') : null)

  const frame = (body: ReactNode) => (
    <div className="df-bc">
      {mode !== 'live' ? <PreviewBanner t={t} /> : null}
      <header className="df-bc-bar">
        <Link href="/">{store.name}</Link>
        <span>{t('checkout.secure')}</span>
      </header>
      <main>{body}</main>
    </div>
  )
  if (c.status === 'loading') return frame(<h1 aria-busy="true">{t('checkout.title')}</h1>)
  if (c.status === 'error')
    return frame(
      <>
        <h1>{t('checkout.failed')}</h1>
        <button type="button" onClick={c.retry}>
          {t('checkout.retry')}
        </button>
      </>,
    )
  const cart = c.cart
  if (c.status === 'empty' || !cart)
    return frame(
      <>
        <h1>{t('checkout.empty')}</h1>
        <Link href="/">{t('checkout.keepShopping')}</Link>
      </>,
    )

  const delivery = cart.shippingOptions.find((o) => o.id === cart.shippingOption)
  const deliveryName = (o: (typeof cart.shippingOptions)[number]) => (o.id === 'pickup' ? t('checkout.pickup') : o.id === 'flat' ? t('checkout.standard') : (o.service ?? t('checkout.courier')))
  const done = (id: CheckoutStepId): string | null =>
    id === 'contact'
      ? [cart.email, cart.phone].filter(Boolean).join(' · ')
      : id === 'address' && cart.shippingAddress
        ? [cart.shippingAddress.name, cart.shippingAddress.line1, cart.shippingAddress.city, cart.shippingAddress.postalCode].filter(Boolean).join(', ')
        : id === 'delivery' && delivery
          ? deliveryName(delivery)
          : id === 'payment' && c.chosen
            ? t(methodWord(c.chosen))
            : null

  const body = (id: CheckoutStepId) => {
    if (id === 'contact') {
      const value = contact ?? { email: cart.email ?? '', phone: cart.phone ?? '' }
      return (
        <Form onSubmit={() => void c.saveContact(value).then(setContactErrors)}>
          <TextField label={t('checkout.email')} type="email" autoComplete="email" value={value.email} onChange={(email) => setContact({ ...value, email })} error={problem(contactErrors.email)} />
          <PhoneField label={t('checkout.phone')} codeLabel={t('address.countryCode')} country={store.address?.country ?? c.countries[0] ?? ''} locale={locale} note={t('address.optional')} value={value.phone} onChange={(phone) => setContact({ ...value, phone })} error={contactErrors.phone === 'invalid' ? t('address.phoneInvalid') : problem(contactErrors.phone)} groupClassName="df-bc-phone" />
          <SubmitButton disabled={c.busy}>{t('checkout.continue')}</SubmitButton>
        </Form>
      )
    }
    if (id === 'address') {
      const draft = address ?? addressDraft(cart.shippingAddress, c.countries[0] ?? '')
      return (
        <Form onSubmit={() => void c.saveAddress(draft).then(setAddressErrors)}>
          <AddressFields value={draft} onChange={setAddress} countries={c.countries} errors={addressErrors} t={t} locale={locale} className="df-bc-fields" phoneClassName="df-bc-phone" />
          <SubmitButton disabled={c.busy}>{t('checkout.continue')}</SubmitButton>
        </Form>
      )
    }
    if (id === 'delivery') {
      return cart.shippingOptions.length === 0 ? (
        <p className="df-bc-line">{t('checkout.noDelivery')}</p>
      ) : (
        <Choices
          legend={t('checkout.delivery')}
          value={cart.shippingOption}
          onChange={(option) => void c.chooseDelivery(option)}
          options={cart.shippingOptions.map((o) => ({ value: o.id, content: <span>{`${deliveryName(o)} · ${isZero(o.amount) ? t('summary.free') : formatMoney(o.amount, locale)}`}</span> }))}
        />
      )
    }
    if (id === 'payment') {
      return c.payments.length === 0 ? (
        <p className="df-bc-line">{t('checkout.noPayment')}</p>
      ) : (
        <Form onSubmit={() => void c.review()}>
          <Choices legend={t('checkout.payment')} value={c.chosen} onChange={c.choosePayment} options={c.payments.map((p) => ({ value: p.provider, content: <span>{t(methodWord(p.provider))}</span> }))} />
          <SubmitButton disabled={c.busy || !c.chosen}>{t('checkout.continue')}</SubmitButton>
        </Form>
      )
    }
    return (
      <>
        <PaymentElement t={t} />
        <PlaceOrder checkout={c} again={t('checkout.payAgain')}>
          {t('checkout.place')}
        </PlaceOrder>
      </>
    )
  }

  return frame(
    <>
      <h1>{t('checkout.title')}</h1>
      {c.error ? (
        <p className="df-bc-alert" role="alert">
          {t(refusalWord(c.error))}
        </p>
      ) : null}
      <div className="df-bc-grid">
        <ol className="df-bc-steps">
          {c.steps.map((s) => (
            <li key={s.id} className="df-bc-step">
              <div className="df-bc-head">
                <h2>{t(stepWord[s.id])}</h2>
                {s.state === 'done' ? (
                  <button type="button" className="df-bc-change" aria-label={t('checkout.changeStep', { step: t(stepWord[s.id]) })} onClick={() => c.edit(s.id)}>
                    {t('checkout.change')}
                  </button>
                ) : null}
              </div>
              {s.state === 'done' && done(s.id) ? <p className="df-bc-line">{done(s.id)}</p> : null}
              {s.state === 'open' ? body(s.id) : null}
            </li>
          ))}
        </ol>
        <aside className="df-bc-side">
          <OrderSummary cart={cart} at="checkout" locale={locale} t={t} />
        </aside>
      </div>
    </>,
  )
}
