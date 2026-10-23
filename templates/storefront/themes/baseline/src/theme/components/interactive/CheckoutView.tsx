'use client'

import { useState } from 'react'
import { clsx } from 'clsx'
import { AddressFields, Choices, CodeField, Form, Link, OrderSummary, PaymentElement, PlaceOrder, Price, SubmitButton, TextField, addressDraft, useAccount, useCart, useCheckout, useStorefront, type AddressField, type CheckoutStepId, type DeliveryOption, type FieldProblem } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { PaymentMethod } from '../PaymentMethod'
import { Retry } from './Retry'
import shop from '../../styles/shop.module.css'
import styles from '../../styles/checkout.module.css'

/** The checkout's body: core's steps as cards, each open, done with its Change, or still to come, beside the sealed summary (D1). */
export const CheckoutView = () => {
  const { store, locale, t } = useStorefront()
  const c = useCheckout()
  const account = useAccount()
  const [email, setEmail] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(null)
  const [contactErrors, setContactErrors] = useState<{ email?: string; phone?: string }>({})
  const [address, setAddress] = useState<ReturnType<typeof addressDraft> | null>(null)
  const [addressErrors, setAddressErrors] = useState<Partial<Record<AddressField, FieldProblem>>>({})

  if (c.status === 'loading') {
    return (
      <section className={shop.page} aria-busy="true">
        <h1 className={shop.title}>{t('shop.checkout.title')}</h1>
        <p className={shop.lead}>{t('shop.checkout.loading')}</p>
      </section>
    )
  }
  if (c.status === 'error') {
    return (
      <section className={shop.page}>
        <Notice main title={t('shop.checkout.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={c.retry} />
        </Notice>
      </section>
    )
  }
  const cart = c.cart
  if (c.status === 'empty' || !cart) {
    return (
      <section className={shop.page}>
        <Notice main title={t('shop.checkout.empty')} lead={t('shop.cart.emptyLead')}>
          <Link href="/collections/all/" className={shop.primary}>
            {t('shop.cart.keepShopping')}
          </Link>
        </Notice>
      </section>
    )
  }
  const stepTitle = (id: CheckoutStepId) =>
    id === 'contact' ? t('shop.checkout.contact') : id === 'address' ? t('shop.checkout.address') : id === 'delivery' ? t('shop.checkout.delivery') : id === 'payment' ? t('shop.checkout.payment') : t('shop.checkout.review')
  const deliveryName = (o: DeliveryOption) => (o.id === 'pickup' ? t('shop.checkout.pickup') : o.id === 'flat' ? t('shop.checkout.standard') : (o.service ?? t('shop.checkout.courier')))
  const shipTo = cart.shippingAddress ? [cart.shippingAddress.name, cart.shippingAddress.line1, cart.shippingAddress.line2, cart.shippingAddress.city, cart.shippingAddress.postalCode, cart.shippingAddress.region].filter(Boolean).join(', ') : null
  const chosenDelivery = cart.shippingOptions.find((o) => o.id === cart.shippingOption) ?? null
  const done = (id: CheckoutStepId) =>
    id === 'contact' ? [cart.email, cart.phone].filter(Boolean).join(' · ') : id === 'address' ? shipTo : id === 'delivery' ? (chosenDelivery ? deliveryName(chosenDelivery) : null) : id === 'payment' && c.chosen ? <PaymentMethod provider={c.chosen} /> : null
  const refusal = (code: string) =>
    code === 'OUT_OF_STOCK'
      ? t('shop.checkout.refusals.outOfStock')
      : code === 'PHONE_REQUIRED'
        ? t('shop.checkout.refusals.phone')
        : code === 'NOT_READY'
          ? t('shop.checkout.refusals.notReady')
          : code === 'OFFER_CHANGED' || code === 'CART_CHANGED'
            ? t('shop.checkout.refusals.changed')
            : t('shop.checkout.refusals.other')
  const problem = (p: string | undefined) => (p === 'required' ? t('shop.checkout.required') : p === 'invalid' ? t('shop.checkout.invalid') : null)

  const body = (id: CheckoutStepId) => {
    if (id === 'contact') {
      return (
        <Form
          className={styles.form}
          onSubmit={() =>
            void c.saveContact({ email: email ?? cart.email ?? account.account?.email ?? '', phone: phone ?? cart.phone ?? account.account?.phone ?? '' }).then((errors) => setContactErrors({ email: problem(errors.email) ?? undefined, phone: (errors.phone === 'invalid' ? t('shop.checkout.phoneInvalid') : problem(errors.phone)) ?? undefined }))
          }
        >
          {c.mode === 'live' && account.status === 'signedOut' ? (
            <p className={styles.note}>
              {t('shop.checkout.haveAccount')}{' '}
              <Link href="/sign-in/?next=/checkout/" className={styles.inline}>
                {t('shop.checkout.signIn')}
              </Link>
            </p>
          ) : null}
          <TextField label={t('shop.checkout.email')} type="email" autoComplete="email" value={email ?? cart.email ?? account.account?.email ?? ''} onChange={setEmail} hint={t('shop.checkout.emailHint')} error={contactErrors.email} className={styles.field} />
          <TextField label={t('shop.checkout.phone')} type="tel" autoComplete="tel" value={phone ?? cart.phone ?? account.account?.phone ?? ''} onChange={setPhone} note={t('shop.checkout.optional')} hint={t('shop.checkout.phoneHint')} error={contactErrors.phone} className={styles.field} />
          <SubmitButton className={shop.primary} disabled={c.busy}>
            {t('shop.checkout.continue')}
          </SubmitButton>
        </Form>
      )
    }
    if (id === 'address') {
      const draft = address ?? addressDraft(cart.shippingAddress, c.countries[0] ?? '')
      return (
        <Form className={styles.form} onSubmit={() => void c.saveAddress(draft).then(setAddressErrors)}>
          <AddressFields value={draft} onChange={setAddress} countries={c.countries} errors={addressErrors} t={t} locale={locale} className={styles.fields} fieldClassName={styles.field} />
          <SubmitButton className={shop.primary} disabled={c.busy}>
            {t('shop.checkout.continue')}
          </SubmitButton>
        </Form>
      )
    }
    if (id === 'delivery') {
      return cart.shippingOptions.length === 0 ? (
        <p className={styles.note}>{t('shop.checkout.noDelivery')}</p>
      ) : (
        <Choices
          legend={t('shop.checkout.delivery')}
          value={cart.shippingOption}
          className={styles.choices}
          optionClassName={styles.choice}
          chosenClassName={clsx(styles.choice, styles.chosen)}
          onChange={(o) => void c.chooseDelivery(o)}
          options={cart.shippingOptions.map((o) => ({
            value: o.id,
            content: (
              <span className={styles.choiceText}>
                <span className={styles.choiceTop}>
                  <span className={styles.choiceName}>{deliveryName(o)}</span>
                  {/^0+$/.test(o.amount.amount) ? <span className={styles.choicePrice}>{t('shop.checkout.free')}</span> : <Price money={o.amount} includesTax={store.pricesIncludeTax} locale={locale} t={t} className={styles.choicePrice} />}
                </span>
                {o.minDays !== null && o.maxDays !== null ? <span className={styles.choiceNote}>{t('shop.checkout.days', { min: o.minDays, max: o.maxDays })}</span> : null}
              </span>
            ),
          }))}
        />
      )
    }
    if (id === 'payment') {
      return (
        <>
          <Form className={styles.form} onSubmit={() => void c.review()}>
            {c.payments.length === 0 ? <p className={styles.note}>{t('shop.checkout.noPayment')}</p> : null}
            <Choices
              legend={t('shop.checkout.payment')}
              value={c.chosen}
              className={styles.choices}
              optionClassName={styles.choice}
              chosenClassName={clsx(styles.choice, styles.chosen)}
              onChange={c.choosePayment}
              options={c.payments.map((p) => ({
                value: p.provider,
                content: (
                  <span className={styles.choiceText}>
                    <span className={styles.choiceName}><PaymentMethod provider={p.provider} /></span>
                  </span>
                ),
              }))}
            />
            <SubmitButton className={shop.primary} disabled={c.busy || !c.chosen}>
              {t('shop.checkout.continue')}
            </SubmitButton>
          </Form>
          <GiftCard />
        </>
      )
    }
    return (
      <div className={styles.form}>
        <dl className={styles.review}>
          <div>
            <dt>{t('shop.checkout.contact')}</dt>
            <dd>{cart.email}</dd>
          </div>
          {shipTo ? (
            <div>
              <dt>{t('shop.checkout.deliverTo')}</dt>
              <dd>{shipTo}</dd>
            </div>
          ) : null}
          {c.chosen ? (
            <div>
              <dt>{t('shop.checkout.payment')}</dt>
              <dd>
                <PaymentMethod provider={c.chosen} />
              </dd>
            </div>
          ) : null}
        </dl>
        <p className={styles.note}>{t('shop.checkout.agree')}</p>
        <PaymentElement t={t} className={styles.payment} />
        <PlaceOrder checkout={c} className={clsx(shop.primary, styles.pay)} again={t('shop.checkout.payAgain')}>
          {t('shop.checkout.place')}
        </PlaceOrder>
        {c.phase.kind === 'failed' && c.phase.orderId === null ? <p className={styles.error} role="alert">{refusal(c.phase.code)}</p> : null}
      </div>
    )
  }

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>{t('shop.checkout.title')}</h1>
      {c.error ? (
        <p className={styles.error} role="alert">
          {refusal(c.error)}
        </p>
      ) : null}
      <div className={styles.layout}>
        <ol className={styles.steps}>
          {c.steps.map((s) => (
            <li key={s.id} className={clsx(styles.step, s.state === 'open' && styles.open)}>
              <div className={styles.stepHead}>
                <span className={clsx(styles.number, s.state === 'done' && styles.numberDone)} aria-hidden="true" />
                <h2 className={styles.stepTitle}>{stepTitle(s.id)}</h2>
                {s.state === 'done' && s.id !== 'review' ? (
                  <button type="button" className={styles.change} aria-label={t('shop.checkout.changeStep', { step: stepTitle(s.id) })} onClick={() => c.edit(s.id)}>
                    {t('shop.checkout.change')}
                  </button>
                ) : null}
              </div>
              {s.state === 'done' && done(s.id) ? <p className={styles.doneLine}>{done(s.id)}</p> : null}
              {s.state === 'open' ? <div className={styles.body}>{body(s.id)}</div> : null}
            </li>
          ))}
        </ol>
        <aside className={styles.side}>
          <h2 className={styles.sideTitle}>{t('shop.checkout.summary')}</h2>
          <OrderSummary cart={cart} at="checkout" locale={locale} t={t} className={styles.summary} />
        </aside>
      </div>
    </section>
  )
}

/** A gift card paying part of the order, as D1's payment step takes one: its number, then what it takes off, or why not. */
const GiftCard = () => {
  const { t } = useStorefront()
  const cart = useCart()
  const [refused, setRefused] = useState<string | null>(null)
  const applied = cart.cart?.giftCard ?? null
  if (applied) {
    return (
      <p className={styles.note}>
        {applied.last4 ? t('shop.checkout.giftCardAppliedEnding', { last4: applied.last4 }) : t('shop.checkout.giftCardApplied')}{' '}
        <button type="button" className={styles.change} onClick={() => void cart.removeGiftCard()}>
          {t('shop.cart.remove')}
        </button>
      </p>
    )
  }
  return (
    <CodeField
      label={t('shop.checkout.giftCard')}
      button={t('shop.cart.apply')}
      message={refused}
      refused={refused !== null}
      className={styles.giftCard}
      onApply={async (number) => {
        const code = await cart.applyGiftCard(number)
        setRefused(code === null ? null : code === 'RATE_LIMITED' ? t('shop.checkout.giftCardTooMany') : code === 'NOT_IN_PREVIEW' ? t('shop.checkout.giftCardPreview') : code === 'GIFT_CARD_INVALID' ? t('shop.checkout.giftCardRefused') : t('shop.checkout.giftCardFailed'))
        return code === null
      }}
    />
  )
}
