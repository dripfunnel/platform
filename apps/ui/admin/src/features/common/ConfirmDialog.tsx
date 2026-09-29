import { useEffect, useId, useRef, useState } from 'react'
import './states.css'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  target: string
  consequence: string
  confirmLabel: string
  cancelLabel: string
  notes?: string[]
  reason?: { label: string; hint: string }
  typeToConfirm?: { label: string; hint: string; expected: string }
  danger?: boolean
  onConfirm: (reason: string | null) => void
  onCancel: () => void
}

// Native <dialog> with showModal(): the page behind it is inert, so focus can't leave it.
// Focus starts on Cancel, the safe choice, and goes back to the trigger on close.
// With a reason the field is required: the API audits it (docs/ui/admin/README.md "Reasons").
// The prototype's Close partner dialog asks only for the typed name, but FIRST-RELEASE.md §1
// and the AGENTS.md logging rules require a reason on every audited write, so the reason
// stays: the entry for the most destructive action in the console cannot be the one without
// a why (decided 2026-09-29).
// typeToConfirm makes the worst actions require the target's own name, exactly, as the admin
// prototype does for Close partner, Suspend store and Undo and clean up. Comparison is exact:
// only the surrounding whitespace is forgiven, because a name that merely looks right is the
// mistake this field exists to catch.
// The hint says why Confirm is disabled, as consoles must (docs/ui/README.md §5).
// Confirm fires once per opening, so a double click can't send an audited action twice;
// on failure the caller closes the dialog and shows the error, and reopening re-arms it.
export const ConfirmDialog = ({
  open,
  title,
  target,
  consequence,
  confirmLabel,
  cancelLabel,
  notes,
  reason,
  typeToConfirm,
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
  const hintId = useId()
  const typedId = useId()
  const typedHintId = useId()
  const [reasonText, setReasonText] = useState('')
  const [typedText, setTypedText] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const reasonMissing = reason !== undefined && reasonText.trim() === ''
  const typedMismatch = typeToConfirm !== undefined && typedText.trim() !== typeToConfirm.expected
  const canConfirm = !confirmed && !reasonMissing && !typedMismatch
  const blockedBy = reasonMissing ? hintId : typedMismatch ? typedHintId : undefined

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setReasonText('')
      setTypedText('')
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
        {notes && notes.length > 0 && (
          <ul className="df-dialog-notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
      {reason && (
        <div className="df-field">
          <label htmlFor={reasonId}>{reason.label}</label>
          <textarea
            id={reasonId}
            required
            rows={3}
            aria-describedby={hintId}
            value={reasonText}
            onChange={(event) => setReasonText(event.target.value)}
          />
          <p id={hintId} className="df-field-hint">
            {reason.hint}
          </p>
        </div>
      )}
      {typeToConfirm && (
        <div className="df-field">
          <label htmlFor={typedId}>{typeToConfirm.label}</label>
          <input
            id={typedId}
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            aria-describedby={typedHintId}
            value={typedText}
            onChange={(event) => setTypedText(event.target.value)}
          />
          <p id={typedHintId} className="df-field-hint">
            {typeToConfirm.hint}
          </p>
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
          aria-describedby={blockedBy}
          onClick={() => {
            setConfirmed(true)
            onConfirm(reason ? reasonText.trim() : null)
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
