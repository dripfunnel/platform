import type { Partner, PartnerAction } from '../../api/partners'
import { fill, messages } from '../../messages'
import { ActionControl, MoreActions } from '@dripfunnel/shared/ui'
import { refusalText } from './refusal'

const words = messages.partner

// The prototype's header order: the setup session, then the approval pair, then the rest
// behind "More actions" (designs/DF Admin Prototype.dc.html, partner header).
const headerActions = ['setupSession', 'sendBack', 'approve'] as const
const menuActions = ['pause', 'resume', 'sendInvite', 'resendInvite'] as const

export interface PartnerActionsProps {
  partner: Partner
  onAction: (action: PartnerAction) => void
}

const isPrimary = (action: PartnerAction, partner: Partner) =>
  action === 'approve' || (action === 'setupSession' && partner.state === 'draft')

export const PartnerActions = ({ partner, onAction }: PartnerActionsProps) => {
  const control = (action: PartnerAction, close?: () => void) => {
    const permission = partner.actions[action]
    if (!permission) return null
    return (
      <ActionControl
        key={action}
        label={words.actions[action]}
        refusal={refusalText(permission, action, partner.name)}
        primary={isPrimary(action, partner)}
        onRun={() => {
          close?.()
          onAction(action)
        }}
      />
    )
  }
  const inMenu = menuActions.filter((action) => partner.actions[action])
  return (
    <div className="df-detail-actions" role="group" aria-label={fill(words.actionsLabel, { name: partner.name })}>
      {headerActions.map((action) => control(action))}
      {inMenu.length > 0 && <MoreActions label={messages.common.moreActions}>{(close) => inMenu.map((action) => control(action, close))}</MoreActions>}
    </div>
  )
}
