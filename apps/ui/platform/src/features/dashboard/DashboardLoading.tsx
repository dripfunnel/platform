import { DashboardSkeleton, LoadingState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/cards.css'
import { fill, messages } from '../../messages'
import './dashboard.css'

const words = messages.dashboard

const shape = <DashboardSkeleton cards={[false, false, false, true, false, true]} />

export const DashboardLoading = ({ product }: { product: string }) => (
  <div className="df-page df-dashboard">
    <h1 className="df-page-title">{words.title}</h1>
    <p className="df-page-lede">{fill(words.lede, { product })}</p>
    <LoadingState label={words.loading} shape={shape} />
  </div>
)
