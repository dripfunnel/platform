import { ErrorState, InfoNote, ListHeader, LoadingState, PermissionDenied, StaleNotice, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import { Link } from '@tanstack/react-router'
import type { BillingMoney, Invoice, MerchantPayment, NextPayout, Payout } from '../../api/billing'
import type { BillingMode } from '../../api/stores'
import { fill, formatAmount, formatDate, formatMonth, formatTime, messages } from '../../messages'
import { ShowMore, type More } from '../common/paged'
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
const payoutLook: Record<Payout['status'], [StatusTone, StatusIconName]> = { paid: ['success', 'ok'], scheduled: ['info', 'clock'], held: ['warning', 'alert'], failed: ['danger', 'cross'] }
const invoiceLook: Record<Invoice['status'], [StatusTone, StatusIconName]> = { paid: ['success', 'ok'], open: ['info', 'clock'], overdue: ['warning', 'alert'] }

export interface Paged<T> {
  items: readonly T[]
  more: More
  onMore: () => void
}

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

const MoreOf = ({ list }: { list: Paged<unknown> }) => <ShowMore more={list.more} onMore={list.onMore} label={words.showMore} failed={words.moreFailed} />

const cardText = (last4: string | null) => (last4 ? fill(words.payments.cardEnding, { last4 }) : words.payments.noCard)

const Payments = ({ money, payments, mode, partner }: { money: BillingMoney; payments: Paged<MerchantPayment>; mode: BillingMode; partner: string }) => {
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
          {money.failed.map((failed) => {
            const why = failed.why ?? w.failedNoWhy
            return (
              <li key={failed.id}>
                <Link to="/stores/$storeId" params={{ storeId: failed.storeId }} search={{ tab: 'billing' }} className="df-row-link">
                  {failed.storeName}
                </Link>
                <strong>{formatAmount(failed.amount)}</strong>
                <span className="df-muted">{failed.cardLast4 ? fill(w.failedWhy, { why, last4: failed.cardLast4 }) : why}</span>
                {failed.retryAt && <span className="df-muted">{fill(w.retry, { time: formatTime(failed.retryAt), attempt: String(failed.attempt), attempts: String(failed.attempts) })}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {money.failedMore && <p className="df-muted">{w.failedMore}</p>}
      <h3>{w.all}</h3>
      {payments.items.length === 0 ? (
        <p className="df-muted">{w.none}</p>
      ) : (
        <Table label={w.all} head={[w.date, w.store, w.amount, w.chargedBy, w.status, w.card]}>
          {payments.items.map((payment) => (
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
      <MoreOf list={payments} />
    </section>
  )
}

const nextPayoutText = (next: NextPayout): string => {
  const w = words.payouts.next
  if (next.state !== 'scheduled') return w[next.state]
  const values = { date: formatDate(next.date), amount: formatAmount(next.soFar) }
  return next.toLast4 ? fill(w.scheduled, { ...values, last4: next.toLast4 }) : fill(w.scheduledNoAccount, values)
}

const Payouts = ({ money, payouts }: { money: BillingMoney; payouts: Paged<Payout> }) => {
  const w = words.payouts
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="billing-payouts">
      <div className="df-stack">
        <h2 id="billing-payouts">{w.title}</h2>
        <span className="df-muted">{w.lede}</span>
      </div>
      <p className={money.nextPayout.state.startsWith('held') ? 'df-billing-held' : undefined}>{nextPayoutText(money.nextPayout)}</p>
      {payouts.items.length === 0 ? (
        <p className="df-muted">{w.none}</p>
      ) : (
        <Table label={w.tableLabel} head={[w.month, w.collected, w.fee, w.adjustments, w.payout, w.paidOn, w.status, w.to]}>
          {payouts.items.map((payout) => (
            <tr key={payout.id}>
              <td>{formatMonth(payout.month)}</td>
              <td>{formatAmount(payout.collected)}</td>
              <td>{formatAmount(payout.fee)}</td>
              <td>
                {payout.adjustment ? (
                  <span className="df-billing-status">
                    {formatAmount(payout.adjustment.amount)}
                    {payout.adjustment.note && <span className="df-muted">{payout.adjustment.note}</span>}
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
              <td>{payout.toLast4 ? fill(w.toAccount, { last4: payout.toLast4 }) : w.noAccount}</td>
            </tr>
          ))}
        </Table>
      )}
      <MoreOf list={payouts} />
    </section>
  )
}

const Invoices = ({ invoices, onPdf }: { invoices: Paged<Invoice>; onPdf: (invoice: Invoice) => void }) => {
  const w = words.invoices
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="billing-invoices">
      <div className="df-stack">
        <h2 id="billing-invoices">{w.title}</h2>
        <span className="df-muted">{w.lede}</span>
      </div>
      {invoices.items.length === 0 ? (
        <p className="df-muted">{w.none}</p>
      ) : (
        <Table label={w.tableLabel} head={[w.id, w.date, w.what, w.amount, w.status, w.pdf]}>
          {invoices.items.map((invoice) => (
            <tr key={invoice.id}>
              <td>{invoice.number ?? w.noNumber}</td>
              <td>{formatDate(invoice.at)}</td>
              <td>{invoice.what}</td>
              <td>{formatAmount(invoice.amount)}</td>
              <td>
                <StatusPill {...look(invoiceLook, invoice.status, w.statuses[invoice.status])} />
              </td>
              <td>
                <button type="button" className="df-link-button" onClick={() => onPdf(invoice)} aria-label={fill(w.pdfFor, { invoice: invoice.number ?? invoice.what })}>
                  {w.pdf}
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <MoreOf list={invoices} />
    </section>
  )
}

// Who bills your merchants (§11.4): the prototype's two choices, changed on selection by Owners and
// Finance (the API refuses everyone else and audits the change); the others see why they can't.
const WhoBills = ({ mode, mayChange, changing, accountLast4, onChange }: { mode: BillingMode; mayChange: boolean; changing: boolean; accountLast4: string | null; onChange: (mode: BillingMode) => void }) => {
  const w = words.settings
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="billing-settings">
      <h2 id="billing-settings">{w.title}</h2>
      {/* Not disabled while saving, so the chosen radio keeps keyboard focus; the screen ignores a second choice until the first is answered. */}
      <fieldset className="df-billing-modes" disabled={!mayChange} aria-busy={changing} aria-describedby={mayChange ? undefined : 'billing-mode-why'}>
        <legend className="df-visually-hidden">{w.title}</legend>
        {(['dripfunnel', 'own'] as const).map((option) => (
          <label key={option} className={option === mode ? 'df-billing-mode df-billing-mode--current' : 'df-billing-mode'}>
            <input type="radio" name="billing-mode" value={option} checked={option === mode} onChange={() => onChange(option)} />
            <span className="df-stack">
              <strong>{w[option].label}</strong>
              <span className="df-muted">{w[option].body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {!mayChange && (
        <div id="billing-mode-why">
          <PermissionDenied actionLabel={w.title} reason={w.ownersAndFinance} />
        </div>
      )}
      <p>
        <strong>{w.payoutAccount}</strong> <span>{accountLast4 ? fill(w.accountEnding, { last4: accountLast4 }) : w.noAccount}</span> ·{' '}
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
  payments: Paged<MerchantPayment>
  payouts: Paged<Payout>
  invoices: Paged<Invoice>
  partner: string
  product: string
  mayChange: boolean
  changing: boolean
  denied: boolean
  onRefresh: () => void
  onChangeMode: (mode: BillingMode) => void
  onPdf: (invoice: Invoice) => void
}

export const Billing = ({ mode, live, money, payments, payouts, invoices, partner, product, mayChange, changing, denied, onRefresh, onChangeMode, onPdf }: BillingProps) => {
  if (denied || !money) {
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
      {money.staleSince && <StaleNotice title={words.staleTitle} body={fill(words.stale, { time: formatTime(money.staleSince) })} refreshLabel={words.refresh} onRefresh={onRefresh} />}
      {!live && !ownBilling && <InfoNote>{fill(words.preLive, { product })}</InfoNote>}
      {live && !ownBilling && (
        <>
          <Payments money={money} payments={payments} mode={mode} partner={partner} />
          <Payouts money={money} payouts={payouts} />
        </>
      )}
      <Invoices invoices={invoices} onPdf={onPdf} />
      <WhoBills mode={mode} mayChange={mayChange} changing={changing} accountLast4={money.payoutAccount.last4} onChange={onChangeMode} />
    </div>
  )
}
