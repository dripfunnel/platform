import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import type { PlanStatus } from '../../api/plans'
import { messages } from '../../messages'

const look: Record<PlanStatus, { tone: StatusTone; icon: StatusIconName }> = {
  live: { tone: 'success', icon: 'ok' },
  draft: { tone: 'neutral', icon: 'pen' },
  retired: { tone: 'neutral', icon: 'cross' },
}

export const PlanStatusPill = ({ status }: { status: PlanStatus }) => <StatusPill {...look[status]} label={messages.plans.statuses[status]} />
