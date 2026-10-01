import { useId } from 'react'
import './states.css'

export interface PermissionDeniedProps {
  actionLabel: string
  reason: string
}

// Consoles show a control the role can't use, disabled with the reason and who can
// (ui/README §5). The reason is visible text, because a disabled button can't take focus.
export const PermissionDenied = ({ actionLabel, reason }: PermissionDeniedProps) => {
  const reasonId = useId()
  return (
    <div className="df-denied">
      <button type="button" className="df-button" disabled aria-describedby={reasonId}>
        {actionLabel}
      </button>
      <p id={reasonId}>{reason}</p>
    </div>
  )
}
