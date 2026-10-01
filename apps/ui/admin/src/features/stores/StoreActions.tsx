import type { JobAction } from '../../api/provisioning'
import type { Store } from '../../api/stores'
import { fill, messages } from '../../messages'
import { ActionControl } from '../common/ActionControl'
import { MoreActions } from '../common/MoreActions'
import { JobActionButton } from '../provisioning/JobActionButton'
import { refusalText } from './refusal'
import type { DialogAction } from './storeDialog'

const words = messages.store

// Retry sits in the header only while setup has failed or is stuck; Undo and clean up lives on
// the Provisioning tab (decided on #20). The rest go behind "More actions".
const menuActions = ['suspend', 'restore', 'extendTrial', 'resendInvite'] as const

export interface StoreActionsProps {
  store: Store
  onAction: (action: DialogAction) => void
  onJob: (action: JobAction) => void
}

export interface StoreActionButtonProps extends Omit<StoreActionsProps, 'onJob'> {
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

export const StoreActions = ({ store, onAction, onJob }: StoreActionsProps) => {
  const inMenu = menuActions.filter((action) => store.actions[action])
  const blocked = store.setup.state === 'failed' || store.setup.state === 'stuck'
  return (
    <div className="df-detail-actions" role="group" aria-label={fill(words.actionsLabel, { name: store.name })}>
      {blocked && store.job && <JobActionButton actions={store.job.actions} action="retry" label={words.retrySetup} onRun={onJob} />}
      {inMenu.length > 0 && (
        <MoreActions>
          {(close) => inMenu.map((action) => <StoreActionButton key={action} store={store} action={action} onAction={onAction} close={close} />)}
        </MoreActions>
      )}
    </div>
  )
}
