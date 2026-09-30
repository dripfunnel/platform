import { useEffect, useId, useRef, useState } from 'react'
import './states.css'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  target: string
  // A function when the consequence depends on the value typed, as a new trial end does.
  consequence: string | ((value: string) => string)
  confirmLabel: string
  cancelLabel: string
  notes?: string[]
  reason?: { label: string; hint: string; placeholder?: string }
  typeToConfirm?: { label: string; hint: string; expected: string }
  // design.md §4's single-field ask: a value the action needs, such as a date. `error` says
  // what is wrong with the value, or null once it will do.
  input?: {
    label: string
    type: 'text' | 'date'
    initial: string
    placeholder?: string
    error: (value: string) => string | null
  }
  danger?: boolean
  onConfirm: (reason: string | null, value: string | null) => void
  onCancel: () => void
}

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
  input,
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
  const inputId = useId()
  const inputErrorId = useId()
  const [reasonText, setReasonText] = useState('')
  const [typedText, setTypedText] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [value, setValue] = useState('')
  const reasonMissing = reason !== undefined && reasonText.trim() === ''
  const typedMismatch = typeToConfirm !== undefined && typedText.trim() !== typeToConfirm.expected
  const inputError = input ? input.error(value) : null
  const canConfirm = !confirmed && !reasonMissing && !typedMismatch && inputError === null
  const blockedBy = reasonMissing ? hintId : typedMismatch ? typedHintId : inputError !== null ? inputErrorId : undefined

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setReasonText('')
      setTypedText('')
      setValue(input?.initial ?? '')
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
        <p>{typeof consequence === 'function' ? consequence(value) : consequence}</p>
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
            placeholder={reason.placeholder}
            aria-describedby={hintId}
            value={reasonText}
            onChange={(event) => setReasonText(event.target.value)}
          />
          <p id={hintId} className="df-field-hint">
            {reason.hint}
          </p>
        </div>
      )}
      {input && (
        <div className="df-field">
          <label htmlFor={inputId}>{input.label}</label>
          <input
            id={inputId}
            type={input.type}
            required
            placeholder={input.placeholder}
            aria-invalid={inputError !== null}
            aria-describedby={inputError !== null ? inputErrorId : undefined}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          {inputError !== null && (
            <p id={inputErrorId} className="df-field-hint">
              {inputError}
            </p>
          )}
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
            onConfirm(reason ? reasonText.trim() : null, input ? value : null)
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
