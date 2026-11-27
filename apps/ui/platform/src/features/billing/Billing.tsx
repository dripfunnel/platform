import { ErrorState, ListHeader, LoadingState, PermissionDenied, StaleNotice, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import type { BillingMoney, Invoice } from '../../api/billing'
import { fill, formatAmount, formatDate, formatTime, messages } from '../../messages'
import { ShowMore, type More } from '../common/paged'
import { RazorpayAccount } from './RazorpayAccount'
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

const invoiceLook: Record<Invoice['status'], [StatusTone, StatusIconName]> = { paid: ['success', 'ok'], open: ['info', 'clock'], overdue: ['warning', 'alert'] }

export interface Paged<T> {
  items: readonly T[]
  more: More
  onMore: () => void
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
        <div className="df-billing-table-wrap">
          <table className="df-billing-table">
            <caption className="df-visually-hidden">{w.tableLabel}</caption>
            <thead>
              <tr>
                {[w.id, w.date, w.what, w.amount, w.status, w.pdf].map((cell) => (
                  <th key={cell} scope="col">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.items.map((invoice) => {
                const [tone, icon] = invoiceLook[invoice.status]
                return (
                  <tr key={invoice.id}>
                    <td>{invoice.number ?? w.noNumber}</td>
                    <td>{formatDate(invoice.at)}</td>
                    <td>{invoice.what}</td>
                    <td>{formatAmount(invoice.amount)}</td>
                    <td>
                      <StatusPill tone={tone} icon={icon} label={w.statuses[invoice.status]} />
                    </td>
                    <td>
                      <button type="button" className="df-link-button" onClick={() => onPdf(invoice)} aria-label={fill(w.pdfFor, { invoice: invoice.number ?? invoice.what })}>
                        {w.pdf}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <ShowMore more={invoices.more} onMore={invoices.onMore} label={words.showMore} failed={words.moreFailed} />
    </section>
  )
}

export interface BillingProps {
  money: BillingMoney | null
  invoices: Paged<Invoice>
  denied: boolean
  mayChange: boolean
  onRefresh: () => void
  onPdf: (invoice: Invoice) => void
  onToast: (message: string) => void
}

// Every partner bills its own merchants (SAAS §7.1, #1743): DripFunnel's invoices, and the Razorpay they bill with (#1744, §11.4).
export const Billing = ({ money, invoices, denied, mayChange, onRefresh, onPdf, onToast }: BillingProps) => {
  if (denied || !money) {
    return (
      <div className="df-page df-list">
        <Header />
        <PermissionDenied actionLabel={screen.title} reason={words.denied} />
      </div>
    )
  }
  return (
    <div className="df-page df-list df-billing">
      <Header />
      {money.staleSince && <StaleNotice title={words.staleTitle} body={fill(words.stale, { time: formatTime(money.staleSince) })} refreshLabel={words.refresh} onRefresh={onRefresh} />}
      <Invoices invoices={invoices} onPdf={onPdf} />
      <RazorpayAccount mayChange={mayChange} onToast={onToast} />
    </div>
  )
}
