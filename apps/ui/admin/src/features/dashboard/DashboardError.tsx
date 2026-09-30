import { useRouter } from '@tanstack/react-router'
import { messages } from '../../messages'
import { ErrorState, type ErrorDetails } from '../common/ErrorState'
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

// The route's error view. It never shows the thrown error: its message can carry internals
// (ErrorState's comment); the API's code arrives with the real client (#13).
export const DashboardRouteError = () => {
  const router = useRouter()
  return <DashboardError sub={words.subLoading} onRetry={() => void router.invalidate()} />
}
