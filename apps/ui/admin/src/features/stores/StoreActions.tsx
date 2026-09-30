import type { Store } from '../../api/stores'
import { fill, messages } from '../../messages'
import { ActionControl } from '../common/ActionControl'
import { MoreActions } from '../common/MoreActions'
import { refusalText } from './refusal'
import type { DialogAction } from './storeDialog'

const words = messages.store

// Retry sits in the header only while setup has failed or is stuck; Undo and clean up lives on
// the Provisioning tab (decided on #20). The rest go behind "More actions".
const menuActions = ['suspend', 'restore', 'extendTrial', 'resendInvite'] as const

export interface StoreActionsProps {
  store: Store
  onAction: (action: DialogAction) => void
}

export interface StoreActionButtonProps extends StoreActionsProps {
  action: DialogAction
  label?: string
  primary?: boolean
  close?: () => void
}

export const StoreActionButton = ({ store, action, label, primary = false, onAction, close }: StoreActionButtonProps) => {
  const permission = store.actions[action]
  if (!permission) return null
  return (
    <ActionControl
      label={label ?? words.actions[action]}
      refusal={refusalText(permission, action)}
      primary={primary}
      onRun={() => {
        close?.()
        onAction(action)
      }}
    />
  )
}

export const StoreActions = ({ store, onAction }: StoreActionsProps) => {
  const inMenu = menuActions.filter((action) => store.actions[action])
  return (
    <div className="df-detail-actions" role="group" aria-label={fill(words.actionsLabel, { name: store.name })}>
      <StoreActionButton store={store} action="retry" primary onAction={onAction} />
      {inMenu.length > 0 && (
        <MoreActions>
          {(close) => inMenu.map((action) => <StoreActionButton key={action} store={store} action={action} onAction={onAction} close={close} />)}
        </MoreActions>
      )}
    </div>
  )
}
