import type { CustomerStatus } from '../../api/customers'
import { messages } from '../../messages'
import { StatusPill, type StatusTone } from '../common/StatusPill'
import type { StatusIconName } from '../shell/Icon'

// The admin prototype's customer pills (designs/DF Admin Prototype.dc.html: cB).
const statusLook: Record<CustomerStatus, { tone: StatusTone; icon: StatusIconName }> = {
  active: { tone: 'success', icon: 'ok' },
  unverified: { tone: 'warning', icon: 'clock' },
  deleted: { tone: 'neutral', icon: 'cross' },
}

export const CustomerStatusPill = ({ status }: { status: CustomerStatus }) => (
  <StatusPill {...statusLook[status]} label={messages.customers.statuses[status]} />
)
