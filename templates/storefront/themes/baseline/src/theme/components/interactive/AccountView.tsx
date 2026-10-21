'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { AddressFields, Checkbox, Form, Link, Price, SubmitButton, TextField, addressDraft, navigate, useAccount, useOrders, useStorefront, type AccountPage, type AddressField, type FieldProblem, type SavedAddress } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { OrderPill } from '../OrderPill'
import { Retry } from './Retry'
import shop from '../../styles/shop.module.css'
import styles from '../../styles/account.module.css'

type Section = 'orders' | 'details' | 'addresses'

const pathOf: Record<Section, string> = { orders: '/account/orders/', details: '/account/', addresses: '/account/addresses/' }

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
      <section className={shop.page} aria-busy="true">
        <h1 className={shop.title}>{t('pages.account.title')}</h1>
      </section>
    )
  }
  if (page.status === 'error' || !page.account) {
    return (
      <section className={shop.page}>
        <Notice main title={t('shop.account.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={page.retry} />
        </Notice>
      </section>
    )
  }
  const first = page.account.name?.split(' ')[0]
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} className={clsx(styles.navItem, on && styles.navOn)} {...(on ? { 'aria-current': 'page' as const } : {})}>
      {label}
    </Link>
  )
  return (
    <section className={shop.page}>
      <div className={styles.hello}>
        <h1 className={styles.title}>{first ? t('shop.account.hello', { name: first }) : t('pages.account.title')}</h1>
        <button type="button" className={styles.link} onClick={() => void page.signOut()}>
          {t('shop.account.signOut')}
        </button>
      </div>
      <div className={styles.account}>
        <nav className={styles.nav} aria-label={t('pages.account.title')}>
          {tab(pathOf.details, t('shop.account.details'), section === 'details')}
          {tab(pathOf.addresses, t('pages.account.addresses'), section === 'addresses')}
          {tab(pathOf.orders, t('shop.orders.title'), section === 'orders')}
        </nav>
        <div className={styles.body}>
          {page.error ? (
            <p className={styles.alert} role="alert">
              {page.error.of === 'details'
                ? t('shop.account.refused.details')
                : page.error.code === 'TOO_MANY'
                  ? t('shop.account.refused.tooManyAddresses')
                  : page.error.code === 'INVALID_INPUT'
                    ? t('shop.account.refused.invalidAddress')
                    : t('shop.account.refused.other')}
            </p>
          ) : null}
          {section === 'orders' ? <Orders /> : section === 'details' ? <Details page={page} /> : <Addresses page={page} />}
        </div>
      </div>
    </section>
  )
}

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className={styles.card}>
    <h2 className={styles.cardTitle}>{title}</h2>
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
        <p className={styles.note} aria-busy="true">
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
        <Link href="/" className={shop.primary}>
          {t('shop.order.keepShopping')}
        </Link>
      </Notice>
    )
  }
  return (
    <Card title={t('shop.orders.title')}>
      <ul className={styles.orders}>
        {page.orders.map((o) => (
          <li key={o.id}>
            <Link href={`/account/orders/${o.id}/`} className={styles.order}>
              <span className={styles.orderFacts}>
                <b>{o.number}</b>
                <span className={styles.note}>{[o.placedOn, t('shop.orders.items', { count: o.items })].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={styles.orderState}>
                <OrderPill order={o} className={styles.orderPill} />
                <Price money={o.total} includesTax={o.includesTax} locale={locale} t={t} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {page.loadMoreFailed ? (
        <p className={styles.alert} role="alert">
          {t('shop.orders.loadMoreFailed')}
        </p>
      ) : null}
      {page.more ? (
        <button type="button" className={shop.secondary} disabled={page.loadingMore} aria-busy={page.loadingMore} onClick={() => void page.loadMore()}>
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
      <Form className={styles.form} onSubmit={() => void page.rename(name ?? account.name ?? '').then((ok) => ok && setName(null))}>
        <TextField label={t('shop.account.name')} autoComplete="name" value={name ?? account.name ?? ''} onChange={setName} className={styles.field} />
        <SubmitButton className={shop.secondary} disabled={page.busy || name === null}>
          {t('shop.account.save')}
        </SubmitButton>
      </Form>
      <dl className={styles.facts}>
        <div>
          <dt>{t('shop.checkout.email')}</dt>
          <dd>
            {account.email ?? t('shop.account.none')} {account.email && account.emailVerified ? <span className={styles.pill}>{t('shop.account.verified')}</span> : null}
          </dd>
        </div>
        <div>
          <dt>{t('shop.checkout.phone')}</dt>
          <dd>
            {account.phone ?? t('shop.account.none')} {account.phone && account.phoneVerified ? <span className={styles.pill}>{t('shop.account.verified')}</span> : null}
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
      {addresses.length === 0 && !draft ? <p className={styles.note}>{t('shop.account.noAddresses')}</p> : null}
      <ul className={styles.addresses}>
        {addresses.map((a) => (
          <li key={a.id} className={styles.address}>
            <p className={styles.addressLine}>
              {line(a)} {a.isDefault ? <span className={styles.pill}>{t('shop.account.default')}</span> : null}
            </p>
            <div className={styles.row}>
              {!a.isDefault ? (
                <button type="button" className={styles.link} disabled={page.busy} onClick={() => void page.makeDefault(a.id)}>
                  {t('shop.account.makeDefault')}
                </button>
              ) : null}
              <button type="button" className={styles.link} disabled={page.busy} aria-label={t('shop.account.removeAddress', { address: line(a) })} onClick={() => void page.removeAddress(a.id)}>
                {t('shop.cart.remove')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {draft ? (
        <Form
          className={styles.form}
          label={t('shop.account.newAddress')}
          onSubmit={() =>
            void page.saveAddress({ id: null, address: draft, isDefault }).then((problems) => {
              if (problems) setErrors(problems)
              if (problems && Object.keys(problems).length === 0) setDraft(null)
            })
          }
        >
          <AddressFields value={draft} onChange={setDraft} countries={page.countries} errors={errors} t={t} locale={locale} className={styles.fields} fieldClassName={styles.field} />
          <Checkbox checked={isDefault} onChange={setIsDefault} className={styles.check}>
            {t('shop.account.makeDefault')}
          </Checkbox>
          <div className={styles.row}>
            <SubmitButton className={shop.primary} disabled={page.busy}>
              {t('shop.account.saveAddress')}
            </SubmitButton>
            <button
              type="button"
              className={shop.secondary}
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
        <button type="button" className={shop.secondary} onClick={() => setDraft(addressDraft(null, page.countries[0] ?? ''))}>
          {t('shop.account.addAddress')}
        </button>
      )}
    </Card>
  )
}
