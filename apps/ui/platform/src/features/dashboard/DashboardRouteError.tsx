import { ErrorState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import type { Me } from '../../api/me'
import { fill, messages } from '../../messages'
import './dashboard.css'
import { DashboardLoading } from './DashboardLoading'

const dashboardRoute = getRouteApi('/_app/dashboard')
const words = messages.dashboard

// The route's error view: never the thrown error's message, which can carry internals (ErrorState).
export const DashboardRouteError = () => {
  const router = useRouter()
  const { me } = dashboardRoute.useRouteContext()
  return (
    <div className="df-page df-dashboard">
      <h1 className="df-page-title">{words.title}</h1>
      <p className="df-page-lede">{fill(words.lede, { product: me.partner.product })}</p>
      <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: () => void router.invalidate() }} />
    </div>
  )
}

// While the loader runs: the Dashboard's skeleton for a Live partner, the checklist's words otherwise.
export const DashboardPending = () => {
  const { me } = dashboardRoute.useRouteContext()
  return <DashboardLoadingFor me={me} />
}

const DashboardLoadingFor = ({ me }: { me: Me }) =>
  me.partner.state === 'live' ? <DashboardLoading product={me.partner.product} /> : <div className="df-page"><div className="df-skeleton" aria-hidden="true" /></div>
