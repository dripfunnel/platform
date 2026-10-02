import { messages } from '../../messages'
import { DashboardSkeleton, LoadingState } from '@dripfunnel/shared/ui'
import { DashboardHeader } from './DashboardHeader'
import './dashboard.css'

const words = messages.dashboard

const shape = <DashboardSkeleton cards={[false, false, false, true, false]} />

export const DashboardLoading = () => (
  <div className="df-page df-dashboard">
    <DashboardHeader sub={words.subLoading} />
    <LoadingState label={words.loading} shape={shape} />
  </div>
)
