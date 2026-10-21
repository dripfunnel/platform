import { StatusPill } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { Report, SalesRow } from '../../api/reports'
import { fill, formatAmount, formatBps, formatCount, formatDate, formatMonth, formatWait, messages, plural } from '../../messages'
import { Bars } from './Bars'

const words = messages.reports
const limitNames: Record<string, string> = words.usage.limits
const stepNames: Record<string, string> = words.setup.steps

const Summary = ({ text }: { text: string }) => <p className="df-report-summary">{text}</p>

const Table = ({ head, children }: { head: readonly string[]; children: React.ReactNode }) => (
  <div className="df-report-table-wrap">
    <table className="df-report-table">
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

export const GrowthTab = ({ data }: { data: Extract<Report, { tab: 'growth' }>['data'] }) => {
  const w = words.growth
  return (
    <section className="df-panel df-report">
      <Summary text={data.summary} />
      <Bars title={w.chart} bars={data.bars.map((bar) => ({ label: bar.label, text: formatCount(bar.count), size: bar.count }))} />
      <Table head={[w.month, w.signups, w.newStores, w.trialToPaid, w.churned, w.netStores]}>
        {data.rows.map((row) => (
          <tr key={row.month}>
            <td>{formatMonth(row.month)}</td>
            <td>{formatCount(row.signups)}</td>
            <td>{formatCount(row.newStores)}</td>
            <td>{row.trialToPaidBps === null ? w.none : formatBps(row.trialToPaidBps)}</td>
            <td>{formatCount(row.churned)}</td>
            <td>
              <strong>{formatCount(row.netStores)}</strong>
            </td>
          </tr>
        ))}
      </Table>
    </section>
  )
}

export const RevenueTab = ({ data }: { data: Extract<Report, { tab: 'revenue' }>['data'] }) => {
  const w = words.revenue
  return (
    <>
      <section className="df-panel df-report">
        <Summary text={data.summary} />
        {data.currencyNote && <span className="df-muted">{data.currencyNote}</span>}
        <Bars title={w.chart} bars={data.bars.map((bar) => ({ label: bar.label, text: formatAmount(bar.amount), size: bar.amount.amount }))} />
        <Table head={[w.month, w.collected, w.fee, w.payout]}>
          {data.rows.map((row) => (
            <tr key={row.month}>
              <td>{formatMonth(row.month)}</td>
              <td>{formatAmount(row.collected)}</td>
              <td>{formatAmount(row.fee)}</td>
              <td>
                <strong>{formatAmount(row.payout)}</strong>
              </td>
            </tr>
          ))}
        </Table>
      </section>
      <div className="df-panels">
        <section className="df-panel" aria-labelledby="report-mrr">
          <h2 id="report-mrr">{w.mrr}</h2>
          <ul className="df-report-list">
            {data.mrr.map((row) => (
              <li key={row.plan}>
                <span>{row.plan}</span>
                <strong>{formatAmount(row.amount)}</strong>
              </li>
            ))}
          </ul>
          {data.mrr.some((row) => row.approximate) && <span className="df-muted">{w.approximate}</span>}
        </section>
        <section className="df-panel" aria-labelledby="report-payments">
          <h2 id="report-payments">{w.payments}</h2>
          <p>
            {fill(plural(w.failed, data.payments.failed), { count: formatCount(data.payments.failed) })}
            {data.payments.failed > 0 && <> · {fill(plural(w.recovered, data.payments.recovered), { count: formatCount(data.payments.recovered) })}</>}
          </p>
          <Link to="/billing" className="df-row-link">
            {w.seeBilling}
          </Link>
        </section>
      </div>
    </>
  )
}

export const PlansTab = ({ data }: { data: Extract<Report, { tab: 'plans' }>['data'] }) => {
  const w = words.plans
  return (
    <section className="df-panel df-report">
      <Summary text={data.summary} />
      <Bars title={w.chart} bars={data.bars.map((bar) => ({ label: bar.label, text: formatCount(bar.count), size: bar.count }))} />
      <Table head={[w.plan, w.stores_col]}>
        {data.rows.map((row) => (
          <tr key={row.plan ?? ''}>
            <td>{row.plan ?? words.noPlan}</td>
            <td>{formatCount(row.stores)}</td>
          </tr>
        ))}
      </Table>
      <h2>{w.changes}</h2>
      {data.changes.length === 0 ? (
        <p className="df-muted">{w.noChanges}</p>
      ) : (
        <ul className="df-report-list">
          {data.changes.map((change) => (
            <li key={`${change.from}-${change.to}`}>
              <span>{fill(w.change, { from: change.from, to: change.to })}</span>
              <strong>{fill(plural(w.stores, change.stores), { count: formatCount(change.stores) })}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const SalesRows = ({ rows }: { rows: readonly SalesRow[] }) => (
  <>
    {rows.map((row) => (
      <tr key={row.storeId}>
        <td>
          <Link to="/stores/$storeId" params={{ storeId: row.storeId }} className="df-row-link">
            {row.store}
          </Link>
        </td>
        <td>{row.plan ?? words.noPlan}</td>
        <td>{formatAmount(row.sales)}</td>
        <td>{formatCount(row.orders)}</td>
        <td className={row.changeBps !== null && row.changeBps < 0 ? 'df-report-down' : undefined}>{row.changeBps === null ? words.stores.noPrior : formatBps(row.changeBps, true)}</td>
      </tr>
    ))}
  </>
)

// Totals per store only; no order, customer or product ever appears here (LOGGING §6).
export const StoresTab = ({ data }: { data: Extract<Report, { tab: 'stores' }>['data'] }) => {
  const w = words.stores
  const head = [w.store, w.plan, w.sales, w.orders, w.change]
  return (
    <section className="df-panel df-report">
      <Summary text={data.summary} />
      {data.note && <span className="df-muted">{data.note}</span>}
      <h2>{w.top}</h2>
      <Table head={head}>
        <SalesRows rows={data.rows} />
      </Table>
      {data.truncated && <span className="df-muted">{w.truncated}</span>}
      <h2>{w.declining}</h2>
      {data.declining.length === 0 ? (
        <p className="df-muted">{w.noDeclining}</p>
      ) : (
        <Table head={head}>
          <SalesRows rows={data.declining} />
        </Table>
      )}
      {data.decliningTruncated && <span className="df-muted">{w.truncated}</span>}
    </section>
  )
}

export const UsageTab = ({ data }: { data: Extract<Report, { tab: 'usage' }>['data'] }) => {
  const w = words.usage
  return (
    <section className="df-panel df-report">
      <Summary text={data.summary} />
      {data.rows.length === 0 ? (
        <p className="df-muted">{w.none}</p>
      ) : (
        <ul className="df-report-rows" aria-label={w.label}>
          {data.rows.map((row) => (
            <li key={`${row.storeId}-${row.limit}`}>
              <Link to="/stores/$storeId" params={{ storeId: row.storeId }} search={{ tab: 'plan' }} className="df-report-row">
                <strong>{row.store}</strong>
                <span>{limitNames[row.limit] ?? row.limit}</span>
                <span>{row.cap === null ? fill(w.noCap, { used: formatCount(row.used) }) : fill(w.of, { used: formatCount(row.used), cap: formatCount(row.cap) })}</span>
                <StatusPill tone={row.percentBps >= 10_000 ? 'danger' : 'warning'} icon={row.percentBps >= 10_000 ? 'cross' : 'alert'} label={row.percentBps >= 10_000 ? w.at : w.near} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.truncated && <span className="df-muted">{w.truncated}</span>}
    </section>
  )
}

const problemText = (row: Extract<Report, { tab: 'setup' }>['data']['rows'][number]): string => {
  const kinds = words.setup.kinds
  if (row.kind === 'domain') return fill(kinds.domain, { host: row.detail ?? '', date: formatDate(row.since) })
  return fill(kinds[row.kind], { step: (row.detail && stepNames[row.detail]) ?? row.detail ?? '', date: formatDate(row.since) })
}

export const SetupTab = ({ data }: { data: Extract<Report, { tab: 'setup' }>['data'] }) => {
  const w = words.setup
  return (
    <section className="df-panel df-report">
      <Summary text={data.summary} />
      <div className="df-report-stats">
        <div>
          <span className="df-muted">{w.median}</span>
          <strong>{data.medianSeconds === null ? w.notYet : formatWait(data.medianSeconds)}</strong>
          <span className="df-muted">{w.medianNote}</span>
        </div>
        <div>
          <span className="df-muted">{w.failed}</span>
          <strong>{formatCount(data.failed)}</strong>
          <span className="df-muted">{w.failedNote}</span>
        </div>
        <div>
          <span className="df-muted">{w.domains}</span>
          <strong>{formatCount(data.domainsStuck)}</strong>
          <span className="df-muted">{w.domainsNote}</span>
        </div>
      </div>
      {data.rows.length === 0 ? (
        <p className="df-muted">{w.none}</p>
      ) : (
        <ul className="df-report-rows">
          {data.rows.map((row) => (
            <li key={`${row.storeId}-${row.kind}`}>
              <Link to="/stores/$storeId" params={{ storeId: row.storeId }} search={{ tab: row.kind === 'domain' ? 'domains' : 'setup' }} className="df-report-row">
                <strong>{row.store}</strong>
                <span>{problemText(row)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.truncated && <span className="df-muted">{w.truncated}</span>}
    </section>
  )
}
