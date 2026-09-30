import { useEffect, useId, useRef, useState } from 'react'
import type { Partner, PartnerAction } from '../../api/partners'
import { fill, messages } from '../../messages'
import { ActionControl } from './ActionControl'
import './partners.css'

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
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const offeredInMenu = menuActions.filter((action) => partner.actions[action])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      toggleRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const control = (action: PartnerAction) => {
    const permission = partner.actions[action]
    if (!permission) return null
    return (
      <ActionControl
        key={action}
        action={action}
        permission={permission}
        partnerName={partner.name}
        label={words.actions[action]}
        primary={isPrimary(action, partner)}
        onRun={() => {
          setOpen(false)
          onAction(action)
        }}
      />
    )
  }

  return (
    <div className="df-partner-actions" role="group" aria-label={fill(words.actionsLabel, { name: partner.name })}>
      {headerActions.map(control)}
      {offeredInMenu.length > 0 && (
        <div className="df-more">
          <button
            ref={toggleRef}
            type="button"
            className="df-button"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((current) => !current)}
          >
            {words.moreActions}
          </button>
          <div id={menuId} className="df-more-panel" hidden={!open}>
            {offeredInMenu.map(control)}
          </div>
        </div>
      )}
    </div>
  )
}
