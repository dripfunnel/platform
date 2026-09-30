import type { ActionPermission } from '../../api/partners'
import { PermissionDenied } from '../common/PermissionDenied'
import { refusalText, type RefusableAction } from './refusal'

export interface ActionControlProps {
  action: RefusableAction
  permission: ActionPermission
  partnerName: string
  label: string
  primary?: boolean
  onRun: () => void
}

// Allowed, it is a button; refused, it stays in place, disabled, with the API's reason as
// visible text beside it (ui/README.md §5, consoles).
export const ActionControl = ({ action, permission, partnerName, label, primary = false, onRun }: ActionControlProps) => {
  const reason = refusalText(permission, action, partnerName)
  if (reason !== null) return <PermissionDenied actionLabel={label} reason={reason} />
  return (
    <button type="button" className={primary ? 'df-button df-button--primary' : 'df-button'} onClick={onRun}>
      {label}
    </button>
  )
}
