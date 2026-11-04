'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { AddressFields, Checkbox, Form, Link, Price, SubmitButton, TextField, addressDraft, navigate, useAccount, useOrders, useStorefront, type AccountPage, type AddressField, type FieldProblem, type SavedAddress } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { OrderPill } from '../OrderPill'
import { Retry } from './Retry'
import { WishlistList } from './WishlistList'

type Section = 'orders' | 'details' | 'addresses' | 'wishlist'

const pathOf: Record<Section, string> = { orders: '/account/orders/', details: '/account/', addresses: '/account/addresses/', wishlist: '/account/wishlist/' }

/** The account as D1 draws it: "Hello", Sign out, its sections beside the one open; a signed-out shopper is sent to sign in. */
export const AccountView = ({ section }: { section: Section }) => {
  const { t } = useStorefront()
  const page = useAccount()
  const here = pathOf[section]
  useEffect(() => {
    if (page.status === 'signedOut') navigate(`/sign-in/?next=${here}`, { replace: true })
  }, [page.status, here])

  if (page.status === 'loading' || page.status === 'signedOut') {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8" aria-busy="true">
        <h1 className="m-0 max-w-[24ch] font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[36px]">{t('pages.account.title')}</h1>
      </section>
    )
  }
  if (page.status === 'error' || !page.account) {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('shop.account.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={page.retry} />
        </Notice>
      </section>
    )
  }
  const first = page.account.name?.split(' ')[0]
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} className={clsx('focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] py-0 px-4 inline-flex min-h-11 items-center rounded-button font-semibold no-underline', !(on) && 'text-ink-soft', on && 'bg-soft text-ink')} {...(on ? { 'aria-current': 'page' as const } : {})}>
      {label}
    </Link>
  )
  return (
    <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
      <div className="flex flex-wrap items-baseline justify-between gap-y-3 gap-x-3">
        <h1 className="m-0 font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] [text-transform:var(--heading-case)]">{first ? t('shop.account.hello', { name: first }) : t('pages.account.title')}</h1>
        <button type="button" className="focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] p-0 border-0 border-current min-h-6 bg-transparent text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[14px] underline underline-offset-[3px] cursor-pointer disabled:opacity-[0.55] disabled:cursor-default" onClick={() => void page.signOut()}>
          {t('shop.account.signOut')}
        </button>
      </div>
      <div className="grid gap-y-5 gap-x-5 items-start min-[900px]:grid-cols-[220px_minmax(0,1fr)] min-[900px]:gap-y-8 min-[900px]:gap-x-8">
        <nav className="flex flex-wrap gap-y-2 gap-x-2 min-[900px]:flex-col" aria-label={t('pages.account.title')}>
          {tab(pathOf.details, t('shop.account.details'), section === 'details')}
          {tab(pathOf.addresses, t('pages.account.addresses'), section === 'addresses')}
          {tab(pathOf.orders, t('shop.orders.title'), section === 'orders')}
          {tab(pathOf.wishlist, t('shop.wishlist.title'), section === 'wishlist')}
        </nav>
        <div className="flex min-w-0 flex-col gap-y-4 gap-x-4">
          {page.error ? (
            <p className="py-3 px-3.5 m-0 border border-line rounded-card bg-soft text-ink" role="alert">
              {page.error.of === 'details'
                ? t('shop.account.refused.details')
                : page.error.code === 'TOO_MANY'
                  ? t('shop.account.refused.tooManyAddresses')
                  : page.error.code === 'INVALID_INPUT'
                    ? t('shop.account.refused.invalidAddress')
                    : t('shop.account.refused.other')}
            </p>
          ) : null}
          {section === 'orders' ? <Orders /> : section === 'details' ? <Details page={page} /> : section === 'wishlist' ? <WishlistList /> : <Addresses page={page} />}
        </div>
      </div>
    </section>
  )
}

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="p-4.5 border border-line flex flex-col gap-y-3.5 gap-x-3.5 rounded-card bg-surface">
    <h2 className="m-0 font-heading text-[22px] font-[var(--heading-weight)]">{title}</h2>
    {children}
  </div>
)

/** D1's Orders: a row per order, newest first, each opening its page; Load more brings the next 20. */
const Orders = () => {
  const { t, locale } = useStorefront()
  const page = useOrders()
  useEffect(() => {
    if (page.status === 'signedOut') navigate(`/sign-in/?next=${pathOf.orders}`, { replace: true })
  }, [page.status])

  if (page.status === 'loading' || page.status === 'signedOut') {
    return (
      <Card title={t('shop.orders.title')}>
        <p className="m-0 text-ink-soft text-[14px]" aria-busy="true">
          {t('shop.orders.loading')}
        </p>
      </Card>
    )
  }
  if (page.status === 'error') {
    return (
      <Notice title={t('shop.orders.failed')} lead={t('shop.listing.failedLead')}>
        <Retry label={t('shop.listing.retry')} onRetry={page.retry} />
      </Notice>
    )
  }
  if (page.empty) {
    return (
      <Notice title={t('shop.orders.empty')} lead={t('shop.orders.emptyLead')}>
        <Link href="/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
          {t('shop.order.keepShopping')}
        </Link>
      </Notice>
    )
  }
  return (
    <Card title={t('shop.orders.title')}>
      <ul className="group/account-orders p-0 m-0 flex flex-col gap-y-3 gap-x-3 list-none">
        {page.orders.map((o) => (
          <li key={o.id}>
            <Link href={`/account/orders/${o.id}/`} className="p-4 border border-line flex items-center justify-between gap-y-3 gap-x-3 rounded-card bg-surface text-ink no-underline hover:border-ink-soft focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
              <span className="flex min-w-0 flex-col gap-y-1 gap-x-1">
                <b>{o.number}</b>
                <span className="m-0 text-ink-soft text-[14px]">{[o.placedOn, t('shop.orders.items', { count: o.items })].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="flex min-w-0 flex-col shrink-0 items-end gap-y-1.5 gap-x-1.5 text-[14px]">
                <OrderPill order={o} className="group-[:nth-child(n)]/account-orders:self-end" />
                <Price money={o.total} includesTax={o.includesTax} locale={locale} t={t} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {page.loadMoreFailed ? (
        <p className="py-3 px-3.5 m-0 border border-line rounded-card bg-soft text-ink" role="alert">
          {t('shop.orders.loadMoreFailed')}
        </p>
      ) : null}
      {page.more ? (
        <button type="button" className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" disabled={page.loadingMore} aria-busy={page.loadingMore} onClick={() => void page.loadMore()}>
          {t('shop.orders.loadMore')}
        </button>
      ) : null}
    </Card>
  )
}

const Details = ({ page }: { page: AccountPage }) => {
  const { t } = useStorefront()
  const account = page.account
  const [name, setName] = useState<string | null>(null)
  if (!account) return null
  return (
    <Card title={t('shop.account.details')}>
      <Form className="grid gap-y-3.5 gap-x-3.5" onSubmit={() => void page.rename(name ?? account.name ?? '').then((ok) => ok && setName(null))}>
        <TextField label={t('shop.account.name')} autoComplete="name" value={name ?? account.name ?? ''} onChange={setName} className={'grid gap-y-1.5 gap-x-1.5 [&_label]:text-[14px] [&_label]:font-semibold [&_small]:text-muted [&_small]:text-[13px] [&_small[role="alert"]]:text-danger [&_input]:py-0 [&_input]:px-3.5 [&_input]:border [&_input]:border-line [&_input]:min-h-12 [&_input]:box-border [&_input]:rounded-[calc(var(--radius-card)_-_4px)] [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit] [&_select]:py-0 [&_select]:px-3.5 [&_select]:border [&_select]:border-line [&_select]:min-h-12 [&_select]:box-border [&_select]:rounded-[calc(var(--radius-card)_-_4px)] [&_select]:bg-surface [&_select]:text-ink [&_select]:[font-family:inherit] [&_select]:[font-size:inherit] [&_select]:[font-weight:inherit] [&_select]:[font-style:inherit] [&_select]:[line-height:inherit] [&_input[aria-invalid="true"]]:border-danger [&>button]:py-0 [&>button]:px-5 [&>button]:border [&>button]:border-line [&>button]:inline-flex [&>button]:min-h-11 [&>button]:items-center [&>button]:justify-center [&>button]:justify-self-start [&>button]:rounded-button [&>button]:bg-surface [&>button]:text-ink [&>button]:[font-family:inherit] [&>button]:[font-size:inherit] [&>button]:[font-style:inherit] [&>button]:[line-height:inherit] [&>button]:font-semibold [&>button]:cursor-pointer [&_[role="dialog"]_button]:py-0 [&_[role="dialog"]_button]:px-5 [&_[role="dialog"]_button]:border [&_[role="dialog"]_button]:border-line [&_[role="dialog"]_button]:inline-flex [&_[role="dialog"]_button]:min-h-11 [&_[role="dialog"]_button]:items-center [&_[role="dialog"]_button]:justify-center [&_[role="dialog"]_button]:justify-self-start [&_[role="dialog"]_button]:rounded-button [&_[role="dialog"]_button]:bg-surface [&_[role="dialog"]_button]:text-ink [&_[role="dialog"]_button]:[font-family:inherit] [&_[role="dialog"]_button]:[font-size:inherit] [&_[role="dialog"]_button]:[font-style:inherit] [&_[role="dialog"]_button]:[line-height:inherit] [&_[role="dialog"]_button]:font-semibold [&_[role="dialog"]_button]:cursor-pointer [&>button:not([aria-expanded])]:p-0 [&>button:not([aria-expanded])]:border-0 [&>button:not([aria-expanded])]:border-current [&>button:not([aria-expanded])]:min-h-6 [&>button:not([aria-expanded])]:bg-transparent [&>button:not([aria-expanded])]:text-[14px] [&>button:not([aria-expanded])]:font-normal [&>button:not([aria-expanded])]:underline [&>button:not([aria-expanded])]:underline-offset-[3px] [&_button:disabled]:opacity-[0.6] [&_button:disabled]:cursor-default [&_[role="dialog"]]:p-4 [&_[role="dialog"]]:mt-1 [&_[role="dialog"]]:border [&_[role="dialog"]]:border-line [&_[role="dialog"]]:grid [&_[role="dialog"]]:grid-cols-[auto_auto_1fr] [&_[role="dialog"]]:gap-y-3 [&_[role="dialog"]]:gap-x-2.5 [&_[role="dialog"]]:rounded-card [&_[role="dialog"]]:bg-surface [&_[role="dialog"]>:not(button)]:m-0 [&_[role="dialog"]>:not(button)]:col-[1_/_-1] [&_[role="dialog"]>p:first-child]:font-semibold [&_[role="dialog"]>p]:text-muted [&_[role="dialog"]>p]:text-[14px] [&_[role="application"]]:border [&_[role="application"]]:border-line [&_[role="application"]]:overflow-hidden [&_[role="application"]]:rounded-[calc(var(--radius-card)_-_4px)] [&_[role="dialog"]>button:first-of-type]:border-accent [&_[role="dialog"]>button:first-of-type]:bg-accent [&_[role="dialog"]>button:first-of-type]:text-accent-ink [&_button:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_button:focus-visible]:outline-offset-[2px] [&_[role="application"]:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_[role="application"]:focus-visible]:outline-offset-[2px]'} />
        <SubmitButton className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" disabled={page.busy || name === null}>
          {t('shop.account.save')}
        </SubmitButton>
      </Form>
      <dl className="m-0 grid gap-y-2.5 gap-x-2.5 [&_div]:grid [&_div]:gap-y-1 [&_div]:gap-x-1 [&_dt]:text-muted [&_dt]:text-[14px] [&_dd]:m-0 [&_dd]:wrap-anywhere">
        <div>
          <dt>{t('shop.checkout.email')}</dt>
          <dd>
            {account.email ?? t('shop.account.none')} {account.email && account.emailVerified ? <span className="py-0.5 px-2.5 inline-block rounded-button bg-tint text-accent text-[12px] font-semibold">{t('shop.account.verified')}</span> : null}
          </dd>
        </div>
        <div>
          <dt>{t('shop.checkout.phone')}</dt>
          <dd>
            {account.phone ?? t('shop.account.none')} {account.phone && account.phoneVerified ? <span className="py-0.5 px-2.5 inline-block rounded-button bg-tint text-accent text-[12px] font-semibold">{t('shop.account.verified')}</span> : null}
          </dd>
        </div>
      </dl>
    </Card>
  )
}

const Addresses = ({ page }: { page: AccountPage }) => {
  const { t, locale } = useStorefront()
  const [draft, setDraft] = useState<ReturnType<typeof addressDraft> | null>(null)
  const [isDefault, setIsDefault] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<AddressField, FieldProblem>>>({})
  const addresses = page.account?.addresses ?? []
  const line = (a: SavedAddress) => [a.name, a.line1, a.line2, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', ')
  return (
    <Card title={t('pages.account.addresses')}>
      {addresses.length === 0 && !draft ? <p className="m-0 text-ink-soft text-[14px]">{t('shop.account.noAddresses')}</p> : null}
      <ul className="p-0 m-0 grid gap-y-2.5 gap-x-2.5 list-none">
        {addresses.map((a) => (
          <li key={a.id} className="pb-2.5 border-b border-b-line grid gap-y-1.5 gap-x-1.5">
            <p className="m-0 wrap-anywhere">
              {line(a)} {a.isDefault ? <span className="py-0.5 px-2.5 inline-block rounded-button bg-tint text-accent text-[12px] font-semibold">{t('shop.account.default')}</span> : null}
            </p>
            <div className="flex flex-wrap items-center gap-y-3.5 gap-x-3.5">
              {!a.isDefault ? (
                <button type="button" className="focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] p-0 border-0 border-current min-h-6 bg-transparent text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[14px] underline underline-offset-[3px] cursor-pointer disabled:opacity-[0.55] disabled:cursor-default" disabled={page.busy} onClick={() => void page.makeDefault(a.id)}>
                  {t('shop.account.makeDefault')}
                </button>
              ) : null}
              <button type="button" className="focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] p-0 border-0 border-current min-h-6 bg-transparent text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[14px] underline underline-offset-[3px] cursor-pointer disabled:opacity-[0.55] disabled:cursor-default" disabled={page.busy} aria-label={t('shop.account.removeAddress', { address: line(a) })} onClick={() => void page.removeAddress(a.id)}>
                {t('shop.cart.remove')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {draft ? (
        <Form
          className="grid gap-y-3.5 gap-x-3.5"
          label={t('shop.account.newAddress')}
          onSubmit={() =>
            void page.saveAddress({ id: null, address: draft, isDefault }).then((problems) => {
              if (problems) setErrors(problems)
              if (problems && Object.keys(problems).length === 0) setDraft(null)
            })
          }
        >
          <AddressFields value={draft} onChange={setDraft} countries={page.countries} errors={errors} t={t} locale={locale} className="grid gap-y-3.5 gap-x-3.5" fieldClassName={'grid gap-y-1.5 gap-x-1.5 [&_label]:text-[14px] [&_label]:font-semibold [&_small]:text-muted [&_small]:text-[13px] [&_small[role="alert"]]:text-danger [&_input]:py-0 [&_input]:px-3.5 [&_input]:border [&_input]:border-line [&_input]:min-h-12 [&_input]:box-border [&_input]:rounded-[calc(var(--radius-card)_-_4px)] [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit] [&_select]:py-0 [&_select]:px-3.5 [&_select]:border [&_select]:border-line [&_select]:min-h-12 [&_select]:box-border [&_select]:rounded-[calc(var(--radius-card)_-_4px)] [&_select]:bg-surface [&_select]:text-ink [&_select]:[font-family:inherit] [&_select]:[font-size:inherit] [&_select]:[font-weight:inherit] [&_select]:[font-style:inherit] [&_select]:[line-height:inherit] [&_input[aria-invalid="true"]]:border-danger [&>button]:py-0 [&>button]:px-5 [&>button]:border [&>button]:border-line [&>button]:inline-flex [&>button]:min-h-11 [&>button]:items-center [&>button]:justify-center [&>button]:justify-self-start [&>button]:rounded-button [&>button]:bg-surface [&>button]:text-ink [&>button]:[font-family:inherit] [&>button]:[font-size:inherit] [&>button]:[font-style:inherit] [&>button]:[line-height:inherit] [&>button]:font-semibold [&>button]:cursor-pointer [&_[role="dialog"]_button]:py-0 [&_[role="dialog"]_button]:px-5 [&_[role="dialog"]_button]:border [&_[role="dialog"]_button]:border-line [&_[role="dialog"]_button]:inline-flex [&_[role="dialog"]_button]:min-h-11 [&_[role="dialog"]_button]:items-center [&_[role="dialog"]_button]:justify-center [&_[role="dialog"]_button]:justify-self-start [&_[role="dialog"]_button]:rounded-button [&_[role="dialog"]_button]:bg-surface [&_[role="dialog"]_button]:text-ink [&_[role="dialog"]_button]:[font-family:inherit] [&_[role="dialog"]_button]:[font-size:inherit] [&_[role="dialog"]_button]:[font-style:inherit] [&_[role="dialog"]_button]:[line-height:inherit] [&_[role="dialog"]_button]:font-semibold [&_[role="dialog"]_button]:cursor-pointer [&>button:not([aria-expanded])]:p-0 [&>button:not([aria-expanded])]:border-0 [&>button:not([aria-expanded])]:border-current [&>button:not([aria-expanded])]:min-h-6 [&>button:not([aria-expanded])]:bg-transparent [&>button:not([aria-expanded])]:text-[14px] [&>button:not([aria-expanded])]:font-normal [&>button:not([aria-expanded])]:underline [&>button:not([aria-expanded])]:underline-offset-[3px] [&_button:disabled]:opacity-[0.6] [&_button:disabled]:cursor-default [&_[role="dialog"]]:p-4 [&_[role="dialog"]]:mt-1 [&_[role="dialog"]]:border [&_[role="dialog"]]:border-line [&_[role="dialog"]]:grid [&_[role="dialog"]]:grid-cols-[auto_auto_1fr] [&_[role="dialog"]]:gap-y-3 [&_[role="dialog"]]:gap-x-2.5 [&_[role="dialog"]]:rounded-card [&_[role="dialog"]]:bg-surface [&_[role="dialog"]>:not(button)]:m-0 [&_[role="dialog"]>:not(button)]:col-[1_/_-1] [&_[role="dialog"]>p:first-child]:font-semibold [&_[role="dialog"]>p]:text-muted [&_[role="dialog"]>p]:text-[14px] [&_[role="application"]]:border [&_[role="application"]]:border-line [&_[role="application"]]:overflow-hidden [&_[role="application"]]:rounded-[calc(var(--radius-card)_-_4px)] [&_[role="dialog"]>button:first-of-type]:border-accent [&_[role="dialog"]>button:first-of-type]:bg-accent [&_[role="dialog"]>button:first-of-type]:text-accent-ink [&_button:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_button:focus-visible]:outline-offset-[2px] [&_[role="application"]:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_[role="application"]:focus-visible]:outline-offset-[2px]'} phoneClassName="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-y-2 gap-x-2" />
          <Checkbox checked={isDefault} onChange={setIsDefault} className="inline-flex min-h-6 items-center gap-y-2 gap-x-2 text-[14px] [&_input]:w-4.5 [&_input]:h-4.5 [&_input]:[accent-color:var(--color-accent)]">
            {t('shop.account.makeDefault')}
          </Checkbox>
          <div className="flex flex-wrap items-center gap-y-3.5 gap-x-3.5">
            <SubmitButton className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" disabled={page.busy}>
              {t('shop.account.saveAddress')}
            </SubmitButton>
            <button
              type="button"
              className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]"
              onClick={() => {
                setDraft(null)
                setErrors({})
              }}
            >
              {t('shop.account.cancel')}
            </button>
          </div>
        </Form>
      ) : (
        <button type="button" className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" onClick={() => setDraft(addressDraft(null, page.countries[0] ?? ''))}>
          {t('shop.account.addAddress')}
        </button>
      )}
    </Card>
  )
}
