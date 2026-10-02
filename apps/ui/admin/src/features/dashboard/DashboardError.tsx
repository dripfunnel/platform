import { useRouter } from '@tanstack/react-router'
import { messages } from '../../messages'
import { ErrorState, type ErrorDetails } from '@dripfunnel/shared/ui'
import { RouteError } from '../common/RouteError'
import { DashboardHeader } from './DashboardHeader'
import './dashboard.css'

const words = messages.dashboard

export interface DashboardErrorProps {
  sub: string
  onRetry: () => void
  details?: ErrorDetails
}

export const DashboardError = ({ sub, onRetry, details }: DashboardErrorProps) => (
  <div className="df-page df-dashboard">
    <DashboardHeader sub={sub} />
    <ErrorState
      title={words.error.title}
      body={words.error.body}
      {...(details ? { details } : {})}
      retry={{ label: words.error.retry, onRetry }}
    />
  </div>
)

// The route's error view, by the error's code; never its message, which can carry internals.
export const DashboardRouteError = ({ error }: { error: unknown }) => {
  const router = useRouter()
  return <RouteError error={error} view={(details) => <DashboardError sub={words.subLoading} onRetry={() => void router.invalidate()} details={details} />} />
}
