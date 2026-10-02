import { ActionControl, MoreActions } from '@dripfunnel/shared/ui'
import { storeActions, type ActionPermission, type Store, type StoreAction } from '../../api/stores'
import { fill, messages } from '../../messages'

const words = messages.store

// The API's refusal code in this console's words; null when the action is allowed.
export const refusalText = (permission: ActionPermission, action: StoreAction, store: Store): string | null =>
  permission.allowed ? null : fill(words.refused[permission.reason], { verb: words.verbs[action], name: store.name })

export interface StoreActionsProps {
  store: Store
  onAction: (action: StoreAction) => void
}

export const StoreActionButton = ({ store, action, onAction, close, label, primary = false }: StoreActionsProps & { action: StoreAction; close?: () => void; label?: string; primary?: boolean }) => {
  const permission = store.actions[action]
  if (!permission) return null
  return (
    <ActionControl
      label={label ?? words.actions[action]}
      refusal={refusalText(permission, action, store)}
      primary={primary}
      danger={action === 'suspend' && permission.allowed}
      onRun={() => {
        close?.()
        onAction(action)
      }}
    />
  )
}

// The prototype's "Actions ▾": every action the store's state offers, allowed or refused with its reason (§6.4).
export const StoreActions = ({ store, onAction }: StoreActionsProps) => {
  const inMenu = storeActions.filter((action) => action !== 'retryStep' && store.actions[action])
  if (inMenu.length === 0) return null
  return (
    <div className="df-detail-actions" role="group" aria-label={fill(words.actionsLabel, { name: store.name })}>
      <MoreActions label={words.moreActions}>{(close) => inMenu.map((action) => <StoreActionButton key={action} store={store} action={action} onAction={onAction} close={close} />)}</MoreActions>
    </div>
  )
}
