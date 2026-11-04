'use client'

import { useState } from 'react'
import { clsx } from 'clsx'
import { AddressFields, Choices, CodeField, Form, Link, OrderSummary, PaymentElement, PhoneField, PlaceOrder, Price, SubmitButton, TextField, addressDraft, useAccount, useCart, useCheckout, useStorefront, type AddressField, type CheckoutStepId, type DeliveryOption, type FieldProblem } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { PaymentMethod } from '../PaymentMethod'
import { Retry } from './Retry'

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
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8" aria-busy="true">
        <h1 className="m-0 max-w-[24ch] font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[36px]">{t('shop.checkout.title')}</h1>
        <p className="m-0 max-w-[60ch] text-muted text-[15px] wrap-anywhere">{t('shop.checkout.loading')}</p>
      </section>
    )
  }
  if (c.status === 'error') {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('shop.checkout.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={c.retry} />
        </Notice>
      </section>
    )
  }
  const cart = c.cart
  if (c.status === 'empty' || !cart) {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('shop.checkout.empty')} lead={t('shop.cart.emptyLead')}>
          <Link href="/collections/all/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
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
          className="grid gap-y-3.5 gap-x-3.5 [&>button]:justify-self-start [&>button]:min-w-40"
          onSubmit={() =>
            void c.saveContact({ email: email ?? cart.email ?? account.account?.email ?? '', phone: phone ?? cart.phone ?? account.account?.phone ?? '' }).then((errors) => setContactErrors({ email: problem(errors.email) ?? undefined, phone: (errors.phone === 'invalid' ? t('shop.checkout.phoneInvalid') : problem(errors.phone)) ?? undefined }))
          }
        >
          {c.mode === 'live' && account.status === 'signedOut' ? (
            <p className="m-0 text-ink-soft text-[14px]">
              {t('shop.checkout.haveAccount')}{' '}
              <Link href="/sign-in/?next=/checkout/" className="text-ink underline-offset-[3px]">
                {t('shop.checkout.signIn')}
              </Link>
            </p>
          ) : null}
          <TextField label={t('shop.checkout.email')} type="email" autoComplete="email" value={email ?? cart.email ?? account.account?.email ?? ''} onChange={setEmail} hint={t('shop.checkout.emailHint')} error={contactErrors.email} className={'grid gap-y-1.5 gap-x-1.5 [&_label]:text-[14px] [&_label]:font-semibold [&_small]:text-muted [&_small]:text-[13px] [&_small]:font-normal [&_small[role="alert"]]:text-danger [&_input]:py-0 [&_input]:px-3.5 [&_input]:border [&_input]:border-line [&_input]:min-h-12 [&_input]:box-border [&_input]:rounded-[calc(var(--radius-card)_-_4px)] [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit] [&_select]:py-0 [&_select]:px-3.5 [&_select]:border [&_select]:border-line [&_select]:min-h-12 [&_select]:box-border [&_select]:rounded-[calc(var(--radius-card)_-_4px)] [&_select]:bg-surface [&_select]:text-ink [&_select]:[font-family:inherit] [&_select]:[font-size:inherit] [&_select]:[font-weight:inherit] [&_select]:[font-style:inherit] [&_select]:[line-height:inherit] [&_input[aria-invalid="true"]]:border-danger [&>button]:py-0 [&>button]:px-5 [&>button]:border [&>button]:border-line [&>button]:inline-flex [&>button]:min-h-11 [&>button]:items-center [&>button]:justify-center [&>button]:justify-self-start [&>button]:rounded-button [&>button]:bg-surface [&>button]:text-ink [&>button]:[font-family:inherit] [&>button]:[font-size:inherit] [&>button]:[font-style:inherit] [&>button]:[line-height:inherit] [&>button]:font-semibold [&>button]:cursor-pointer [&_[role="dialog"]_button]:py-0 [&_[role="dialog"]_button]:px-5 [&_[role="dialog"]_button]:border [&_[role="dialog"]_button]:border-line [&_[role="dialog"]_button]:inline-flex [&_[role="dialog"]_button]:min-h-11 [&_[role="dialog"]_button]:items-center [&_[role="dialog"]_button]:justify-center [&_[role="dialog"]_button]:justify-self-start [&_[role="dialog"]_button]:rounded-button [&_[role="dialog"]_button]:bg-surface [&_[role="dialog"]_button]:text-ink [&_[role="dialog"]_button]:[font-family:inherit] [&_[role="dialog"]_button]:[font-size:inherit] [&_[role="dialog"]_button]:[font-style:inherit] [&_[role="dialog"]_button]:[line-height:inherit] [&_[role="dialog"]_button]:font-semibold [&_[role="dialog"]_button]:cursor-pointer [&>button:not([aria-expanded])]:p-0 [&>button:not([aria-expanded])]:border-0 [&>button:not([aria-expanded])]:border-current [&>button:not([aria-expanded])]:min-h-6 [&>button:not([aria-expanded])]:bg-transparent [&>button:not([aria-expanded])]:text-[14px] [&>button:not([aria-expanded])]:font-normal [&>button:not([aria-expanded])]:underline [&>button:not([aria-expanded])]:underline-offset-[3px] [&_button:disabled]:opacity-[0.6] [&_button:disabled]:cursor-default [&_[role="dialog"]]:p-4 [&_[role="dialog"]]:mt-1 [&_[role="dialog"]]:border [&_[role="dialog"]]:border-line [&_[role="dialog"]]:grid [&_[role="dialog"]]:grid-cols-[auto_auto_1fr] [&_[role="dialog"]]:gap-y-3 [&_[role="dialog"]]:gap-x-2.5 [&_[role="dialog"]]:rounded-card [&_[role="dialog"]]:bg-surface [&_[role="dialog"]>:not(button)]:m-0 [&_[role="dialog"]>:not(button)]:col-[1_/_-1] [&_[role="dialog"]>p:first-child]:font-semibold [&_[role="dialog"]>p]:text-muted [&_[role="dialog"]>p]:text-[14px] [&_[role="application"]]:border [&_[role="application"]]:border-line [&_[role="application"]]:overflow-hidden [&_[role="application"]]:rounded-[calc(var(--radius-card)_-_4px)] [&_[role="dialog"]>button:first-of-type]:border-accent [&_[role="dialog"]>button:first-of-type]:bg-accent [&_[role="dialog"]>button:first-of-type]:text-accent-ink [&_button:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_button:focus-visible]:outline-offset-[2px] [&_[role="application"]:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_[role="application"]:focus-visible]:outline-offset-[2px]'} />
          <PhoneField label={t('shop.checkout.phone')} codeLabel={t('shop.checkout.countryCode')} country={store.address?.country ?? c.countries[0] ?? ''} locale={locale} value={phone ?? cart.phone ?? account.account?.phone ?? ''} onChange={setPhone} note={t('shop.checkout.optional')} hint={t('shop.checkout.phoneHint')} error={contactErrors.phone} className={'grid gap-y-1.5 gap-x-1.5 [&_label]:text-[14px] [&_label]:font-semibold [&_small]:text-muted [&_small]:text-[13px] [&_small]:font-normal [&_small[role="alert"]]:text-danger [&_input]:py-0 [&_input]:px-3.5 [&_input]:border [&_input]:border-line [&_input]:min-h-12 [&_input]:box-border [&_input]:rounded-[calc(var(--radius-card)_-_4px)] [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit] [&_select]:py-0 [&_select]:px-3.5 [&_select]:border [&_select]:border-line [&_select]:min-h-12 [&_select]:box-border [&_select]:rounded-[calc(var(--radius-card)_-_4px)] [&_select]:bg-surface [&_select]:text-ink [&_select]:[font-family:inherit] [&_select]:[font-size:inherit] [&_select]:[font-weight:inherit] [&_select]:[font-style:inherit] [&_select]:[line-height:inherit] [&_input[aria-invalid="true"]]:border-danger [&>button]:py-0 [&>button]:px-5 [&>button]:border [&>button]:border-line [&>button]:inline-flex [&>button]:min-h-11 [&>button]:items-center [&>button]:justify-center [&>button]:justify-self-start [&>button]:rounded-button [&>button]:bg-surface [&>button]:text-ink [&>button]:[font-family:inherit] [&>button]:[font-size:inherit] [&>button]:[font-style:inherit] [&>button]:[line-height:inherit] [&>button]:font-semibold [&>button]:cursor-pointer [&_[role="dialog"]_button]:py-0 [&_[role="dialog"]_button]:px-5 [&_[role="dialog"]_button]:border [&_[role="dialog"]_button]:border-line [&_[role="dialog"]_button]:inline-flex [&_[role="dialog"]_button]:min-h-11 [&_[role="dialog"]_button]:items-center [&_[role="dialog"]_button]:justify-center [&_[role="dialog"]_button]:justify-self-start [&_[role="dialog"]_button]:rounded-button [&_[role="dialog"]_button]:bg-surface [&_[role="dialog"]_button]:text-ink [&_[role="dialog"]_button]:[font-family:inherit] [&_[role="dialog"]_button]:[font-size:inherit] [&_[role="dialog"]_button]:[font-style:inherit] [&_[role="dialog"]_button]:[line-height:inherit] [&_[role="dialog"]_button]:font-semibold [&_[role="dialog"]_button]:cursor-pointer [&>button:not([aria-expanded])]:p-0 [&>button:not([aria-expanded])]:border-0 [&>button:not([aria-expanded])]:border-current [&>button:not([aria-expanded])]:min-h-6 [&>button:not([aria-expanded])]:bg-transparent [&>button:not([aria-expanded])]:text-[14px] [&>button:not([aria-expanded])]:font-normal [&>button:not([aria-expanded])]:underline [&>button:not([aria-expanded])]:underline-offset-[3px] [&_button:disabled]:opacity-[0.6] [&_button:disabled]:cursor-default [&_[role="dialog"]]:p-4 [&_[role="dialog"]]:mt-1 [&_[role="dialog"]]:border [&_[role="dialog"]]:border-line [&_[role="dialog"]]:grid [&_[role="dialog"]]:grid-cols-[auto_auto_1fr] [&_[role="dialog"]]:gap-y-3 [&_[role="dialog"]]:gap-x-2.5 [&_[role="dialog"]]:rounded-card [&_[role="dialog"]]:bg-surface [&_[role="dialog"]>:not(button)]:m-0 [&_[role="dialog"]>:not(button)]:col-[1_/_-1] [&_[role="dialog"]>p:first-child]:font-semibold [&_[role="dialog"]>p]:text-muted [&_[role="dialog"]>p]:text-[14px] [&_[role="application"]]:border [&_[role="application"]]:border-line [&_[role="application"]]:overflow-hidden [&_[role="application"]]:rounded-[calc(var(--radius-card)_-_4px)] [&_[role="dialog"]>button:first-of-type]:border-accent [&_[role="dialog"]>button:first-of-type]:bg-accent [&_[role="dialog"]>button:first-of-type]:text-accent-ink [&_button:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_button:focus-visible]:outline-offset-[2px] [&_[role="application"]:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_[role="application"]:focus-visible]:outline-offset-[2px]'} groupClassName="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-y-2 gap-x-2" />
          <SubmitButton className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" disabled={c.busy}>
            {t('shop.checkout.continue')}
          </SubmitButton>
        </Form>
      )
    }
    if (id === 'address') {
      const draft = address ?? addressDraft(cart.shippingAddress, c.countries[0] ?? '')
      return (
        <Form className="grid gap-y-3.5 gap-x-3.5 [&>button]:justify-self-start [&>button]:min-w-40" onSubmit={() => void c.saveAddress(draft).then(setAddressErrors)}>
          <AddressFields value={draft} onChange={setAddress} countries={c.countries} errors={addressErrors} t={t} locale={locale} className="grid gap-y-3.5 gap-x-3.5" fieldClassName={'grid gap-y-1.5 gap-x-1.5 [&_label]:text-[14px] [&_label]:font-semibold [&_small]:text-muted [&_small]:text-[13px] [&_small]:font-normal [&_small[role="alert"]]:text-danger [&_input]:py-0 [&_input]:px-3.5 [&_input]:border [&_input]:border-line [&_input]:min-h-12 [&_input]:box-border [&_input]:rounded-[calc(var(--radius-card)_-_4px)] [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit] [&_select]:py-0 [&_select]:px-3.5 [&_select]:border [&_select]:border-line [&_select]:min-h-12 [&_select]:box-border [&_select]:rounded-[calc(var(--radius-card)_-_4px)] [&_select]:bg-surface [&_select]:text-ink [&_select]:[font-family:inherit] [&_select]:[font-size:inherit] [&_select]:[font-weight:inherit] [&_select]:[font-style:inherit] [&_select]:[line-height:inherit] [&_input[aria-invalid="true"]]:border-danger [&>button]:py-0 [&>button]:px-5 [&>button]:border [&>button]:border-line [&>button]:inline-flex [&>button]:min-h-11 [&>button]:items-center [&>button]:justify-center [&>button]:justify-self-start [&>button]:rounded-button [&>button]:bg-surface [&>button]:text-ink [&>button]:[font-family:inherit] [&>button]:[font-size:inherit] [&>button]:[font-style:inherit] [&>button]:[line-height:inherit] [&>button]:font-semibold [&>button]:cursor-pointer [&_[role="dialog"]_button]:py-0 [&_[role="dialog"]_button]:px-5 [&_[role="dialog"]_button]:border [&_[role="dialog"]_button]:border-line [&_[role="dialog"]_button]:inline-flex [&_[role="dialog"]_button]:min-h-11 [&_[role="dialog"]_button]:items-center [&_[role="dialog"]_button]:justify-center [&_[role="dialog"]_button]:justify-self-start [&_[role="dialog"]_button]:rounded-button [&_[role="dialog"]_button]:bg-surface [&_[role="dialog"]_button]:text-ink [&_[role="dialog"]_button]:[font-family:inherit] [&_[role="dialog"]_button]:[font-size:inherit] [&_[role="dialog"]_button]:[font-style:inherit] [&_[role="dialog"]_button]:[line-height:inherit] [&_[role="dialog"]_button]:font-semibold [&_[role="dialog"]_button]:cursor-pointer [&>button:not([aria-expanded])]:p-0 [&>button:not([aria-expanded])]:border-0 [&>button:not([aria-expanded])]:border-current [&>button:not([aria-expanded])]:min-h-6 [&>button:not([aria-expanded])]:bg-transparent [&>button:not([aria-expanded])]:text-[14px] [&>button:not([aria-expanded])]:font-normal [&>button:not([aria-expanded])]:underline [&>button:not([aria-expanded])]:underline-offset-[3px] [&_button:disabled]:opacity-[0.6] [&_button:disabled]:cursor-default [&_[role="dialog"]]:p-4 [&_[role="dialog"]]:mt-1 [&_[role="dialog"]]:border [&_[role="dialog"]]:border-line [&_[role="dialog"]]:grid [&_[role="dialog"]]:grid-cols-[auto_auto_1fr] [&_[role="dialog"]]:gap-y-3 [&_[role="dialog"]]:gap-x-2.5 [&_[role="dialog"]]:rounded-card [&_[role="dialog"]]:bg-surface [&_[role="dialog"]>:not(button)]:m-0 [&_[role="dialog"]>:not(button)]:col-[1_/_-1] [&_[role="dialog"]>p:first-child]:font-semibold [&_[role="dialog"]>p]:text-muted [&_[role="dialog"]>p]:text-[14px] [&_[role="application"]]:border [&_[role="application"]]:border-line [&_[role="application"]]:overflow-hidden [&_[role="application"]]:rounded-[calc(var(--radius-card)_-_4px)] [&_[role="dialog"]>button:first-of-type]:border-accent [&_[role="dialog"]>button:first-of-type]:bg-accent [&_[role="dialog"]>button:first-of-type]:text-accent-ink [&_button:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_button:focus-visible]:outline-offset-[2px] [&_[role="application"]:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_[role="application"]:focus-visible]:outline-offset-[2px]'} phoneClassName="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-y-2 gap-x-2" />
          <SubmitButton className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" disabled={c.busy}>
            {t('shop.checkout.continue')}
          </SubmitButton>
        </Form>
      )
    }
    if (id === 'delivery') {
      return cart.shippingOptions.length === 0 ? (
        <p className="m-0 text-ink-soft text-[14px]">{t('shop.checkout.noDelivery')}</p>
      ) : (
        <Choices
          legend={t('shop.checkout.delivery')}
          value={cart.shippingOption}
          className="p-0 m-0 border-0 border-current grid gap-y-2.5 gap-x-2.5 [&_legend]:absolute [&_legend]:overflow-hidden [&_legend]:w-px [&_legend]:h-px [&_legend]:[clip-path:inset(50%)]"
          optionClassName="p-3.5 border border-line flex items-start gap-y-3 gap-x-3 rounded-card cursor-pointer [&_input]:mt-0.5 [&_input]:mr-0 [&_input]:mb-0 [&_input]:ml-0 [&_input]:w-4.5 [&_input]:h-4.5 [&_input]:[accent-color:var(--color-accent)]"
          chosenClassName={clsx('p-3.5 border border-line flex items-start gap-y-3 gap-x-3 rounded-card cursor-pointer [&_input]:mt-0.5 [&_input]:mr-0 [&_input]:mb-0 [&_input]:ml-0 [&_input]:w-4.5 [&_input]:h-4.5 [&_input]:[accent-color:var(--color-accent)]', 'p-3.5 border-[2px] border-ink flex items-start gap-y-3 gap-x-3 rounded-card cursor-pointer')}
          onChange={(o) => void c.chooseDelivery(o)}
          options={cart.shippingOptions.map((o) => ({
            value: o.id,
            content: (
              <span className="flex flex-1 flex-col gap-y-0.5 gap-x-0.5">
                <span className="flex justify-between gap-y-3 gap-x-3">
                  <span className="font-semibold">{deliveryName(o)}</span>
                  {/^0+$/.test(o.amount.amount) ? <span className="shrink-0 font-semibold">{t('shop.checkout.free')}</span> : <Price money={o.amount} includesTax={store.pricesIncludeTax} locale={locale} t={t} className="shrink-0 font-semibold" />}
                </span>
                {o.minDays !== null && o.maxDays !== null ? <span className="text-muted text-[14px]">{t('shop.checkout.days', { min: o.minDays, max: o.maxDays })}</span> : null}
              </span>
            ),
          }))}
        />
      )
    }
    if (id === 'payment') {
      return (
        <>
          <Form className="grid gap-y-3.5 gap-x-3.5 [&>button]:justify-self-start [&>button]:min-w-40" onSubmit={() => void c.review()}>
            {c.payments.length === 0 ? <p className="m-0 text-ink-soft text-[14px]">{t('shop.checkout.noPayment')}</p> : null}
            <Choices
              legend={t('shop.checkout.payment')}
              value={c.chosen}
              className="p-0 m-0 border-0 border-current grid gap-y-2.5 gap-x-2.5 [&_legend]:absolute [&_legend]:overflow-hidden [&_legend]:w-px [&_legend]:h-px [&_legend]:[clip-path:inset(50%)]"
              optionClassName="p-3.5 border border-line flex items-start gap-y-3 gap-x-3 rounded-card cursor-pointer [&_input]:mt-0.5 [&_input]:mr-0 [&_input]:mb-0 [&_input]:ml-0 [&_input]:w-4.5 [&_input]:h-4.5 [&_input]:[accent-color:var(--color-accent)]"
              chosenClassName={clsx('p-3.5 border border-line flex items-start gap-y-3 gap-x-3 rounded-card cursor-pointer [&_input]:mt-0.5 [&_input]:mr-0 [&_input]:mb-0 [&_input]:ml-0 [&_input]:w-4.5 [&_input]:h-4.5 [&_input]:[accent-color:var(--color-accent)]', 'p-3.5 border-[2px] border-ink flex items-start gap-y-3 gap-x-3 rounded-card cursor-pointer')}
              onChange={c.choosePayment}
              options={c.payments.map((p) => ({
                value: p.provider,
                content: (
                  <span className="flex flex-1 flex-col gap-y-0.5 gap-x-0.5">
                    <span className="font-semibold"><PaymentMethod provider={p.provider} /></span>
                  </span>
                ),
              }))}
            />
            <SubmitButton className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" disabled={c.busy || !c.chosen}>
              {t('shop.checkout.continue')}
            </SubmitButton>
          </Form>
          <GiftCard />
        </>
      )
    }
    return (
      <div className="grid gap-y-3.5 gap-x-3.5 [&>button]:justify-self-start [&>button]:min-w-40">
        <dl className="m-0 grid gap-y-2 gap-x-2 [&_div]:grid [&_div]:grid-cols-[minmax(90px,30%)_1fr] [&_div]:gap-y-3 [&_div]:gap-x-3 [&_dt]:text-muted [&_dd]:m-0 [&_dd]:wrap-anywhere">
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
        <p className="m-0 text-ink-soft text-[14px]">{t('shop.checkout.agree')}</p>
        <PaymentElement t={t} className="[--df-sealed-size:15px]" />
        <PlaceOrder checkout={c} className={clsx('py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]', 'self-stretch disabled:opacity-[0.55] disabled:cursor-default')} again={t('shop.checkout.payAgain')}>
          {t('shop.checkout.place')}
        </PlaceOrder>
        {c.phase.kind === 'failed' && c.phase.orderId === null ? <p className="py-3 px-3.5 m-0 border border-line rounded-card bg-soft text-danger" role="alert">{refusal(c.phase.code)}</p> : null}
      </div>
    )
  }

  return (
    <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto">
      <h1 className="m-0 font-heading text-[26px] font-[var(--heading-weight)] leading-[1.2]">{t('shop.checkout.title')}</h1>
      {c.error ? (
        <p className="py-3 px-3.5 m-0 border border-line rounded-card bg-soft text-danger" role="alert">
          {refusal(c.error)}
        </p>
      ) : null}
      <div className="grid gap-y-5 gap-x-5 items-start min-[900px]:grid-cols-[minmax(0,1fr)_400px] min-[900px]:gap-y-8 min-[900px]:gap-x-8">
        <ol className="p-0 m-0 [counter-reset:step] grid gap-y-3.5 gap-x-3.5 list-none">
          {c.steps.map((s) => (
            <li key={s.id} className={clsx('p-4.5 border [counter-increment:step] rounded-card bg-surface', !(s.state === 'open') && 'border-line', s.state === 'open' && 'group/checkout-open border-ink-soft')}>
              <div className="flex items-center gap-y-2.5 gap-x-2.5">
                <span className={clsx('group-[:nth-child(n)]/checkout-open:bg-accent group-[:nth-child(n)]/checkout-open:text-accent-ink', !(s.state === 'done') && 'inline-flex w-6.5 h-6.5 shrink-0 items-center justify-center rounded-full bg-soft text-ink text-[13px] font-bold [&::before]:[content:counter(step)]', s.state === 'done' && 'inline-flex w-6.5 h-6.5 shrink-0 items-center justify-center rounded-full text-[13px] font-bold bg-accent text-accent-ink [&::before]:[content:counter(step)]')} aria-hidden="true" />
                <h2 className="m-0 flex-1 text-[18px] font-[650]">{stepTitle(s.id)}</h2>
                {s.state === 'done' && s.id !== 'review' ? (
                  <button type="button" className="py-0 px-1 border-0 border-current min-h-11 bg-transparent text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[14px] underline underline-offset-[3px] cursor-pointer" aria-label={t('shop.checkout.changeStep', { step: stepTitle(s.id) })} onClick={() => c.edit(s.id)}>
                    {t('shop.checkout.change')}
                  </button>
                ) : null}
              </div>
              {s.state === 'done' && done(s.id) ? <p className="mt-1.5 mr-0 mb-0 ml-9 text-ink-soft wrap-anywhere">{done(s.id)}</p> : null}
              {s.state === 'open' ? <div className="mt-3.5">{body(s.id)}</div> : null}
            </li>
          ))}
        </ol>
        <aside className="p-5 border border-line flex flex-col gap-y-3.5 gap-x-3.5 rounded-card bg-surface min-[900px]:sticky min-[900px]:top-6">
          <h2 className="m-0 font-heading text-[22px] font-[var(--heading-weight)]">{t('shop.checkout.summary')}</h2>
          <OrderSummary cart={cart} at="checkout" locale={locale} t={t} className="[--df-sealed-size:15px] [--df-sealed-saving:var(--color-accent)]" />
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
      <p className="m-0 text-ink-soft text-[14px]">
        {applied.last4 ? t('shop.checkout.giftCardAppliedEnding', { last4: applied.last4 }) : t('shop.checkout.giftCardApplied')}{' '}
        <button type="button" className="py-0 px-1 border-0 border-current min-h-11 bg-transparent text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[14px] underline underline-offset-[3px] cursor-pointer" onClick={() => void cart.removeGiftCard()}>
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
      className="mt-4 grid grid-cols-[1fr_auto] gap-y-2 gap-x-2 [&_label]:col-[1_/_-1] [&_label]:text-[14px] [&_label]:font-semibold [&_input]:py-0 [&_input]:px-3.5 [&_input]:border [&_input]:border-line [&_input]:min-h-12 [&_input]:box-border [&_input]:rounded-[calc(var(--radius-card)_-_4px)] [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit] [&_button]:py-0 [&_button]:px-5 [&_button]:border [&_button]:border-ink [&_button]:min-h-12 [&_button]:rounded-button [&_button]:bg-transparent [&_button]:text-ink [&_button]:[font-family:inherit] [&_button]:[font-size:inherit] [&_button]:[font-style:inherit] [&_button]:[line-height:inherit] [&_button]:font-semibold [&_button]:cursor-pointer [&_p]:m-0 [&_p]:col-[1_/_-1] [&_p]:text-[14px]"
      onApply={async (number) => {
        const code = await cart.applyGiftCard(number)
        setRefused(code === null ? null : code === 'RATE_LIMITED' ? t('shop.checkout.giftCardTooMany') : code === 'NOT_IN_PREVIEW' ? t('shop.checkout.giftCardPreview') : code === 'GIFT_CARD_INVALID' ? t('shop.checkout.giftCardRefused') : t('shop.checkout.giftCardFailed'))
        return code === null
      }}
    />
  )
}
