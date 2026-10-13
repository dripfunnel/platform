'use client'

import { clsx } from 'clsx'
import { Link, OrderSummary, PaymentElement, useOrder, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { PaymentMethod } from '../PaymentMethod'
import { Retry } from './Retry'
import shop from '../../styles/shop.module.css'
import styles from '../../styles/order.module.css'

/**
 * The order's page (`/order/{id}/`), as D1's order confirmation: where it stands, what to do next, and what was charged;
 * `inAccount`, the same order in the account (`/account/orders/{id}/`), headed by its number.
 */
export const OrderView = ({ inAccount = false }: { inAccount?: boolean }) => {
  const { locale, t } = useStorefront()
  const page = useOrder()

  if (page.status === 'loading') {
    return (
      <section className={shop.page} aria-busy="true">
        <h1 className={shop.title}>{t('shop.order.loading')}</h1>
      </section>
    )
  }
  if (page.status === 'error') {
    return (
      <section className={shop.page}>
        <Notice main title={t('shop.order.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={page.retry} />
        </Notice>
      </section>
    )
  }
  const order = page.order
  if (!order) {
    return (
      <section className={shop.page}>
        <Notice main title={t('shop.order.missing')} lead={t('shop.order.missingLead')}>
          <Link href="/" className={shop.primary}>
            {t('shop.order.keepShopping')}
          </Link>
        </Notice>
      </section>
    )
  }
  const pill = order.cancelled
    ? { words: t('shop.order.pills.cancelled'), tone: styles.pillBad }
    : order.payment === 'paid'
      ? { words: t('shop.order.pills.paid'), tone: styles.pillGood }
      : order.payment === 'refunded'
        ? { words: t('shop.order.pills.refunded'), tone: styles.pillInfo }
        : order.payment === 'confirming'
          ? { words: t('shop.order.pills.confirming'), tone: styles.pillWarn }
          : order.method === 'cod'
            ? { words: t('shop.order.pills.cod'), tone: styles.pillInfo }
            : { words: t('shop.order.pills.transfer'), tone: styles.pillWarn }
  const awaiting = !order.cancelled && order.payment === 'awaiting'
  return (
    <section className={shop.page}>
      <div className={styles.order}>
        <div className={styles.main}>
          <div className={styles.head}>
            {inAccount ? (
              <Link href="/account/" className={styles.back}>
                {t('shop.order.backToAccount')}
              </Link>
            ) : null}
            <span className={clsx(styles.pill, pill.tone)}>{pill.words}</span>
            <h1 className={styles.title}>{order.cancelled ? t('shop.order.cancelledTitle') : inAccount ? t('shop.order.summary', { number: order.number }) : t('shop.order.title')}</h1>
            {order.cancelled ? <p className={styles.lead}>{t('shop.order.cancelledLead', { number: order.number })}</p> : inAccount ? null : <p className={styles.lead}>{t('shop.order.lead', { number: order.number })}</p>}
          </div>
          {awaiting && order.method === 'bank_transfer' ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>{t('shop.order.transferTitle')}</h2>
              <p className={styles.note}>{order.payBy ? t('shop.order.transferBy', { number: order.number, date: order.payBy }) : t('shop.order.transferRef', { number: order.number })}</p>
              {order.instructions ? <p className={styles.instructions}>{order.instructions}</p> : null}
            </div>
          ) : null}
          {awaiting && order.method === 'cod' ? <p className={styles.info}>{t('shop.order.cod')}</p> : null}
          {!order.cancelled && order.payment === 'confirming' ? (
            <div className={styles.card}>
              <p className={styles.note} role="status">
                {t('shop.order.confirming')}
              </p>
              <div className={styles.actions}>
                <Retry label={t('shop.order.checkAgain')} onRetry={page.retry} />
                {page.payAgain ? (
                  <button type="button" className={shop.primary} onClick={page.payAgain}>
                    {t('shop.order.payAgain')}
                  </button>
                ) : null}
              </div>
              <PaymentElement t={t} />
            </div>
          ) : null}
          {order.downloads.length > 0 ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>{t('shop.order.downloads')}</h2>
              <ul className={styles.list}>
                {order.downloads.map((d, i) => (
                  <li key={i} className={styles.item}>
                    {d.url ? (
                      <Link href={d.url} className={shop.secondary}>
                        {t('shop.order.download', { name: d.name })}
                      </Link>
                    ) : (
                      <span>{d.name}</span>
                    )}
                    {d.usesLeft !== null && d.until ? <span className={styles.note}>{t('shop.order.downloadLeft', { count: d.usesLeft, date: d.until })}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {order.licenceKeys.length > 0 ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>{t('shop.order.keys')}</h2>
              <dl className={styles.facts}>
                {order.licenceKeys.map((k, i) => (
                  <div key={i}>
                    <dt>{k.name}</dt>
                    <dd className={styles.key}>{k.key}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {order.lines.flatMap((l, i) =>
            l.gift ? [
              <p key={i} className={styles.info}>
                {l.gift.sendOn ? t('shop.order.giftOn', { name: l.gift.recipientName, date: l.gift.sendOn }) : t('shop.order.giftNow', { name: l.gift.recipientName })}
              </p>,
            ] : [],
          )}
          <div className={styles.card}>
            <dl className={styles.facts}>
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
          <div className={styles.actions}>
            <Link href="/" className={shop.secondary}>
              {t('shop.order.keepShopping')}
            </Link>
          </div>
        </div>
        <aside className={styles.side}>
          <h2 className={styles.sideTitle}>{inAccount ? t('shop.checkout.summary') : t('shop.order.summary', { number: order.number })}</h2>
          <OrderSummary order={order} locale={locale} t={t} className={styles.summary} />
        </aside>
      </div>
    </section>
  )
}
