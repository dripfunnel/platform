import type { StatusIconName } from '@dripfunnel/shared/ui'
import type { HostStatus, InvitationStatus, PartnerState } from '../../api/partners'
import { messages } from '../../messages'
import { StatusPill, type StatusTone } from '../common/StatusPill'
import './partners.css'

const words = messages.partners

interface Look {
  tone: StatusTone
  icon: StatusIconName
}

// The admin prototype's partner states (designs/DF Admin Prototype.dc.html, PST).
const stateLook: Record<PartnerState, Look> = {
  draft: { tone: 'neutral', icon: 'pen' },
  awaiting: { tone: 'info', icon: 'hour' },
  live: { tone: 'success', icon: 'ok' },
  paused: { tone: 'warning', icon: 'pause' },
  offboarding: { tone: 'warning', icon: 'clock' },
  closed: { tone: 'neutral', icon: 'ban' },
}

const hostLook: Record<HostStatus, Look> = {
  live: { tone: 'success', icon: 'ok' },
  waiting: { tone: 'warning', icon: 'clock' },
  failed: { tone: 'danger', icon: 'alert' },
  notSet: { tone: 'neutral', icon: 'pen' },
}

const invitationLook: Record<InvitationStatus, Look> = {
  active: { tone: 'success', icon: 'ok' },
  sent: { tone: 'info', icon: 'hour' },
  held: { tone: 'neutral', icon: 'pause' },
}

export const PartnerStatePill = ({ state }: { state: PartnerState }) => (
  <StatusPill {...stateLook[state]} label={words.states[state]} />
)

export const HostPill = ({ status }: { status: HostStatus }) => <StatusPill {...hostLook[status]} label={words.hostStatus[status]} />

export const InvitationPill = ({ status }: { status: InvitationStatus }) => (
  <StatusPill {...invitationLook[status]} label={words.invitation[status]} />
)

export const HouseBadge = () => <span className="df-pill df-house-badge">{words.houseBadge}</span>

