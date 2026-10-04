import { ErrorState, InfoNote, ListHeader, LoadingState, PermissionDenied, StaleNotice, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import { Link } from '@tanstack/react-router'
import type { BillingMoney, Invoice, MerchantPayment, NextPayout, Payout } from '../../api/billing'
import type { BillingMode } from '../../api/stores'
import { fill, formatAmount, formatDate, formatMonth, formatTime, messages } from '../../messages'
import './billing.css'

const words = messages.billing
const screen = messages.screens.billing

const Header = () => <ListHeader title={screen.title} sub={screen.lede} />

export const BillingLoading = () => (
  <div className="df-page df-list">
    <Header />
    <LoadingState label={words.loading} rows={5} />
  </div>
)

export const BillingError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const look = <T extends string>(map: Record<T, [StatusTone, StatusIconName]>, status: T, label: string) => ({ tone: map[status][0], icon: map[status][1], label })

const paymentLook: Record<MerchantPayment['status'], [StatusTone, StatusIconName]> = { paid: ['success', 'ok'], failed: ['danger', 'cross'], recovered: ['success', 'ok'], refunded: ['neutral', 'clock'] }
const payoutLook: Record<Payout['status'], [StatusTone, StatusIconName]> = { paid: ['success', 'ok'], scheduled: ['info', 'clock'], failed: ['danger', 'cross'] }
const invoiceLook: Record<Invoice['status'], [StatusTone, StatusIconName]> = { paid: ['success', 'ok'], open: ['info', 'clock'], overdue: ['warning', 'alert'] }

const Table = ({ label, head, children }: { label: string; head: readonly string[]; children: React.ReactNode }) => (
  <div className="df-billing-table-wrap">
    <table className="df-billing-table">
      <caption className="df-visually-hidden">{label}</caption>
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell} scope="col">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
)

const cardText = (last4: string | null) => (last4 ? fill(words.payments.cardEnding, { last4 }) : words.payments.noCard)

const Payments = ({ money, mode, partner }: { money: BillingMoney; mode: BillingMode; partner: string }) => {
  const w = words.payments
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="billing-payments">
      <div className="df-stack">
        <h2 id="billing-payments">{w.title}</h2>
        <span className="df-muted">{fill(w.lede[mode], { partner })}</span>
      </div>
      <h3>{w.failedTitle}</h3>
      {money.failed.length === 0 ? (
        <p className="df-muted">{w.noFailed}</p>
      ) : (
        <ul className="df-billing-failed">
          {money.failed.map((failed) => (
            <li key={`${failed.storeId}-${failed.retryAt}`}>
              <Link to="/stores/$storeId" params={{ storeId: failed.storeId }} search={{ tab: 'billing' }} className="df-row-link">
                {failed.storeName}
              </Link>
              <strong>{formatAmount(failed.amount)}</strong>
              <span className="df-muted">{failed.cardLast4 ? fill(w.failedWhy, { why: failed.why, last4: failed.cardLast4 }) : failed.why}</span>
              <span className="df-muted">{fill(w.retry, { time: formatTime(failed.retryAt), attempt: String(failed.attempt), attempts: String(failed.attempts) })}</span>
            </li>
          ))}
        </ul>
      )}
      <h3>{w.all}</h3>
      {money.payments.length === 0 ? (
        <p className="df-muted">{w.none}</p>
      ) : (
        <Table label={w.all} head={[w.date, w.store, w.amount, w.chargedBy, w.status, w.card]}>
          {money.payments.map((payment) => (
            <tr key={payment.id}>
              <td>{formatDate(payment.at)}</td>
              <td>
                <Link to="/stores/$storeId" params={{ storeId: payment.storeId }} search={{ tab: 'billing' }} className="df-row-link">
                  {payment.storeName}
                </Link>
              </td>
              <td>
                <strong>{formatAmount(payment.amount)}</strong>
              </td>
              <td>{fill(mode === 'dripfunnel' ? w.byDripFunnel : w.byPartner, { partner })}</td>
              <td>
                <span className="df-billing-status">
                  <StatusPill {...look(paymentLook, payment.status, w.statuses[payment.status])} />
                  {payment.note && <span className="df-muted">{payment.note}</span>}
                </span>
              </td>
              <td>{cardText(payment.cardLast4)}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  )
}

const nextPayoutText = (next: NextPayout): string => {
  const w = words.payouts.next
  return next.state === 'scheduled' ? fill(w.scheduled, { date: formatDate(next.date), amount: formatAmount(next.soFar), last4: next.toLast4 }) : w[next.state]
}

const Payouts = ({ money }: { money: BillingMoney }) => {
  const w = words.payouts
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="billing-payouts">
      <div className="df-stack">
        <h2 id="billing-payouts">{w.title}</h2>
        <span className="df-muted">{w.lede}</span>
      </div>
      <p className={money.nextPayout.state === 'heldVerification' || money.nextPayout.state === 'heldContract' ? 'df-billing-held' : undefined}>{nextPayoutText(money.nextPayout)}</p>
      {money.payouts.length === 0 ? (
        <p className="df-muted">{w.none}</p>
      ) : (
        <Table label={w.tableLabel} head={[w.month, w.collected, w.fee, w.adjustments, w.payout, w.paidOn, w.status, w.to]}>
          {money.payouts.map((payout) => (
            <tr key={payout.month}>
              <td>{formatMonth(payout.month)}</td>
              <td>{formatAmount(payout.collected)}</td>
              <td>{formatAmount(payout.fee)}</td>
              <td>
                {payout.adjustment ? (
                  <span className="df-billing-status">
                    {formatAmount(payout.adjustment.amount)}
                    <span className="df-muted">{payout.adjustment.note}</span>
                  </span>
                ) : (
                  w.noAdjustment
                )}
              </td>
              <td>
                <strong>{formatAmount(payout.payout)}</strong>
              </td>
              <td>{payout.paidOn ? formatDate(payout.paidOn) : w.notPaid}</td>
              <td>
                <StatusPill {...look(payoutLook, payout.status, w.statuses[payout.status])} />
              </td>
              <td>{fill(w.toAccount, { last4: payout.toLast4 })}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  )
}

const Invoices = ({ invoices }: { invoices: readonly Invoice[] }) => {
  const w = words.invoices
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="billing-invoices">
      <div className="df-stack">
        <h2 id="billing-invoices">{w.title}</h2>
        <span className="df-muted">{w.lede}</span>
      </div>
      {invoices.length === 0 ? (
        <p className="df-muted">{w.none}</p>
      ) : (
        <Table label={w.tableLabel} head={[w.id, w.date, w.what, w.amount, w.status, w.pdf]}>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>{invoice.id}</td>
              <td>{formatDate(invoice.at)}</td>
              <td>{invoice.what}</td>
              <td>{formatAmount(invoice.amount)}</td>
              <td>
                <StatusPill {...look(invoiceLook, invoice.status, w.statuses[invoice.status])} />
              </td>
              <td>
                {invoice.pdfUrl ? (
                  <a href={invoice.pdfUrl} className="df-row-link">
                    {w.pdf}
                  </a>
                ) : (
                  <span className="df-muted">{w.noPdf}</span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  )
}

// Who bills your merchants (§11.4): the API's mode, both choices described; changing it waits on #201.
const WhoBills = ({ mode, mayChange, accountLast4 }: { mode: BillingMode; mayChange: boolean; accountLast4: string | null }) => {
  const w = words.settings
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="billing-settings">
      <h2 id="billing-settings">{w.title}</h2>
      <ul className="df-billing-modes">
        {(['dripfunnel', 'own'] as const).map((option) => (
          <li key={option} className={option === mode ? 'df-billing-mode df-billing-mode--current' : 'df-billing-mode'} aria-current={option === mode ? 'true' : undefined}>
            <strong>
              {w[option].label}
              {option === mode && <span className="df-billing-current">{w.current}</span>}
            </strong>
            <span className="df-muted">{w[option].body}</span>
          </li>
        ))}
      </ul>
      {mayChange ? <p className="df-muted">{w.changeLater}</p> : <PermissionDenied actionLabel={w.title} reason={w.ownersAndFinance} />}
      <p>
        <strong>{w.payoutAccount}</strong> {accountLast4 && <span>{fill(w.accountEnding, { last4: accountLast4 })} · </span>}
        <Link to="/settings" search={{ tab: 'payout' }} className="df-row-link">
          {w.payoutLink}
        </Link>
      </p>
    </section>
  )
}

export interface BillingProps {
  mode: BillingMode
  live: boolean
  money: BillingMoney | null
  partner: string
  product: string
  mayChange: boolean
  denied: boolean
  onRefresh: () => void
}

export const Billing = ({ mode, live, money, partner, product, mayChange, denied, onRefresh }: BillingProps) => {
  if (denied) {
    return (
      <div className="df-page df-list">
        <Header />
        <PermissionDenied actionLabel={screen.title} reason={words.denied} />
      </div>
    )
  }
  // When the partner bills itself, Billing is DripFunnel's invoices and Settings only (§11.4).
  const ownBilling = mode === 'own'
  return (
    <div className="df-page df-list df-billing">
      <Header />
      {money?.staleSince && <StaleNotice title={words.staleTitle} body={fill(words.stale, { time: formatTime(money.staleSince) })} refreshLabel={words.refresh} onRefresh={onRefresh} />}
      {!live && !ownBilling && <InfoNote>{fill(words.preLive, { product })}</InfoNote>}
      {(live || ownBilling) && !money && <InfoNote>{words.notConnected[mode]}</InfoNote>}
      {live && money && !ownBilling && (
        <>
          <Payments money={money} mode={mode} partner={partner} />
          <Payouts money={money} />
        </>
      )}
      {money && <Invoices invoices={money.invoices} />}
      <WhoBills mode={mode} mayChange={mayChange} accountLast4={money?.payoutAccountLast4 ?? null} />
    </div>
  )
}
