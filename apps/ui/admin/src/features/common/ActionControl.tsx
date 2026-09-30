import { PermissionDenied } from './PermissionDenied'

export interface ActionControlProps {
  label: string
  // The API's refusal in the console's words, or null when the action is allowed.
  refusal: string | null
  primary?: boolean
  // Allowed but not ready yet, such as a note with nothing typed.
  disabled?: boolean
  onRun: () => void
}

// Allowed, it is a button; refused, it stays in place, disabled, with the reason as visible
// text beside it (ui/README.md §5, consoles). Never a tooltip: keyboards and touch can't reach one.
export const ActionControl = ({ label, refusal, primary = false, disabled = false, onRun }: ActionControlProps) => {
  if (refusal !== null) return <PermissionDenied actionLabel={label} reason={refusal} />
  return (
    <button type="button" className={primary ? 'df-button df-button--primary' : 'df-button'} disabled={disabled} onClick={onRun}>
      {label}
    </button>
  )
}
