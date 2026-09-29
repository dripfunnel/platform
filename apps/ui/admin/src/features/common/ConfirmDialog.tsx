import { useEffect, useId, useRef, useState } from 'react'
import './states.css'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  target: string
  consequence: string
  confirmLabel: string
  cancelLabel: string
  reasonLabel?: string
  danger?: boolean
  onConfirm: (reason: string | null) => void
  onCancel: () => void
}

// Native <dialog> with showModal(): the page behind it is inert, so focus can't leave it.
// Focus starts on Cancel, the safe choice, and goes back to the trigger on close.
// With reasonLabel the reason is required: the API audits it (docs/ui/admin/README.md "Reasons").
// Confirm fires once per opening, so a double click can't send an audited action twice;
// on failure the caller closes the dialog and shows the error, and reopening re-arms it.
export const ConfirmDialog = ({
  open,
  title,
  target,
  consequence,
  confirmLabel,
  cancelLabel,
  reasonLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const bodyId = useId()
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const asksReason = reasonLabel !== undefined
  const canConfirm = !confirmed && (!asksReason || reason.trim() !== '')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setReason('')
      setConfirmed(false)
      dialog.showModal()
      cancelRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="df-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      onClose={() => triggerRef.current?.focus()}
    >
      <h2 id={titleId}>{title}</h2>
      <div id={bodyId} className="df-dialog-body">
        <p>
          <strong>{target}</strong>
        </p>
        <p>{consequence}</p>
      </div>
      {asksReason && (
        <div className="df-field">
          <label htmlFor={reasonId}>{reasonLabel}</label>
          <textarea
            id={reasonId}
            required
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      )}
      <div className="df-actions">
        <button ref={cancelRef} type="button" className="df-button" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? 'df-button df-button--danger' : 'df-button df-button--primary'}
          disabled={!canConfirm}
          onClick={() => {
            setConfirmed(true)
            onConfirm(asksReason ? reason.trim() : null)
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
