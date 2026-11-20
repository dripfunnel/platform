import type { StatusIconName, StatusTone } from '@dripfunnel/shared/ui'
import type { HostStatus } from '../../api/domains'
import { messages } from '../../messages'

// A custom domain's status pill (SAAS.md §8), on Domains and on a store's list row and Domains tab.
const statusLook: Record<HostStatus, { tone: StatusTone; icon: StatusIconName }> = {
  waiting: { tone: 'warning', icon: 'hour' },
  verifying: { tone: 'info', icon: 'clock' },
  issuing: { tone: 'info', icon: 'clock' },
  live: { tone: 'success', icon: 'ok' },
  failed: { tone: 'danger', icon: 'cross' },
  expiring: { tone: 'warning', icon: 'alert' },
  broken: { tone: 'danger', icon: 'alert' },
}

export const statusPill = (status: HostStatus) => ({ ...statusLook[status], label: messages.domains.status[status] })
