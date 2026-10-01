import type { JobAction, JobPermissions } from '../../api/provisioning'
import { fill, messages } from '../../messages'
import { ActionControl } from '../common/ActionControl'

const words = messages.provisioning

// Words for the API's refusal code. A running job holds both actions back, each with its own
// reason, as the prototype words them.
const refusalText = (permission: NonNullable<JobPermissions[JobAction]>, action: JobAction): string | null => {
  if (permission.allowed) return null
  if (permission.reason === 'JOB_RUNNING') return words.refusals.JOB_RUNNING[action]
  return fill(words.refusals[permission.reason], { verb: words.verbs[action] })
}

export interface JobActionButtonProps {
  actions: JobPermissions
  action: JobAction
  label?: string
  onRun: (action: JobAction) => void
}

// Retry is the primary control and Undo and clean up the destructive one, on the Provisioning
// list and the store's tab alike. An action the API doesn't offer for the job isn't shown.
export const JobActionButton = ({ actions, action, label, onRun }: JobActionButtonProps) => {
  const permission = actions[action]
  if (!permission) return null
  return (
    <ActionControl
      label={label ?? words.actions[action]}
      refusal={refusalText(permission, action)}
      primary={action === 'retry'}
      danger={action === 'undo'}
      onRun={() => onRun(action)}
    />
  )
}
