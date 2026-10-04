// States (?state=): loading, empty, error, readonly, denied. Without one the screen shows the API's catalogue.
import { ClickableRow, EmptyState, ErrorState, ListHeader, LoadingState, PermissionDenied, ReadOnlyNotice } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import { Link } from '@tanstack/react-router'
import type { Me } from '../../api/me'
import type { PlanPermission, PlanRow, PlansPage } from '../../api/plans'
import { fill, formatAmount, formatCount, messages } from '../../messages'
import { PlanStatusPill } from './planLook'
import type { PlansState } from './plansHarness'
import './plans.css'

const words = messages.plans
const screen = messages.screens.plans

export interface PlansProps {
  me: Me
  page: PlansPage
  forced: PlansState | null
  onReload: () => void
}

const NewPlan = ({ permission, label = words.newPlan }: { permission: PlanPermission; label?: string }) =>
  permission.allowed ? (
    <Link to="/plans/$planId" params={{ planId: 'new' }} className="df-button df-button--primary">
      {label}
    </Link>
  ) : (
    <PermissionDenied actionLabel={label} reason={words.refused[permission.reason]} />
  )

const Header = ({ action }: { action?: React.ReactNode }) => <ListHeader title={screen.title} sub={screen.lede} action={action} />

export const PlansLoading = () => (
  <div className="df-page df-list">
    <Header />
    <LoadingState label={words.loading} rows={4} />
  </div>
)

export const PlansError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const Row = ({ plan }: { plan: PlanRow }) => (
  <ClickableRow>
    <th scope="row">
      <div className="df-stack">
        <Link to="/plans/$planId" params={{ planId: plan.id }} className="df-row-title">
          {plan.name}
        </Link>
        <span className="df-muted">{plan.description}</span>
      </div>
    </th>
    <td>
      <div className="df-stack">
        {plan.prices.map((price) => (
          <span key={price.currency}>
            {price.monthly && price.yearly
              ? fill(words.priceLine, { monthly: formatAmount(price.monthly), yearly: formatAmount(price.yearly) })
              : price.monthly
                ? fill(words.monthlyOnly, { monthly: formatAmount(price.monthly) })
                : `${price.currency} · ${words.unpriced}`}
          </span>
        ))}
        {plan.prices[0]?.fee && <span className="df-muted">{fill(words.feeLine, { fee: formatAmount(plan.prices[0].fee) })}</span>}
      </div>
    </td>
    <td>{plan.trialDays === 0 ? words.noTrial : fill(words.trialDays, { count: formatCount(plan.trialDays) })}</td>
    <td className="df-number">
      <Link to="/stores" search={{ plan: plan.id }} className="df-row-link" aria-label={fill(words.storesLabel, { count: formatCount(plan.stores), plan: plan.name })}>
        {formatCount(plan.stores)}
      </Link>
    </td>
    <td>
      <PlanStatusPill status={plan.status} />
    </td>
  </ClickableRow>
)

export const Plans = ({ me, page, forced, onReload }: PlansProps) => {
  if (forced === 'loading') return <PlansLoading />
  if (forced === 'error') return <PlansError onRetry={onReload} />
  if (forced === 'empty' || page.items.length === 0) {
    return (
      <div className="df-page df-list">
        <Header />
        <EmptyState title={words.empty.title} body={words.empty.body} action={<NewPlan permission={page.actions.create} label={words.empty.action} />} />
      </div>
    )
  }
  return (
    <div className="df-page df-list">
      {(me.role === 'partner-read-only' || forced === 'readonly') && <ReadOnlyNotice title={messages.states.readonly.title} body={messages.states.readonly.body} />}
      <Header action={<NewPlan permission={page.actions.create} />} />
      <p className="df-muted">{fill(words.note, { who: page.chargedBy })}</p>
      <div className="df-table-scroll" role="region" aria-label={words.tableLabel} tabIndex={0}>
        <table className="df-table df-plans-table">
          <thead>
            <tr>
              {Object.values(words.columns).map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.items.map((plan) => (
              <Row key={plan.id} plan={plan} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
