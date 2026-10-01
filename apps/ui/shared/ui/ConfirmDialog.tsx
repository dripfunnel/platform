import { useEffect, useId, useRef, useState } from 'react'
import './states.css'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  target: string
  // A function when the consequence depends on the value typed, as a new trial end does.
  consequence: string | ((value: string, choice: string) => string)
  confirmLabel: string
  cancelLabel: string
  notes?: string[]
  reason?: { label: string; hint: string; placeholder?: string }
  typeToConfirm?: { label: string; hint: string; expected: string }
  // design.md §4's single-field ask: a value the action needs, such as a date. `error` says
  // what is wrong with the value, or null once it will do.
  input?: {
    label: string
    type: 'text' | 'date' | 'email'
    initial: string
    placeholder?: string
    error: (value: string) => string | null
  }
  // One pick from a short list, such as a role. `error` says why the pick won't do, or null.
  choice?: {
    label: string
    options: readonly { value: string; label: string }[]
    initial: string
    error: (choice: string) => string | null
  }
  danger?: boolean
  onConfirm: (reason: string | null, value: string | null, choice: string | null) => void
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
  choice,
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
  const choiceId = useId()
  const choiceErrorId = useId()
  const [reasonText, setReasonText] = useState('')
  const [typedText, setTypedText] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [value, setValue] = useState('')
  const [picked, setPicked] = useState('')
  const reasonMissing = reason !== undefined && reasonText.trim() === ''
  const typedMismatch = typeToConfirm !== undefined && typedText.trim() !== typeToConfirm.expected
  const inputError = input ? input.error(value) : null
  const choiceError = choice ? choice.error(picked) : null
  const canConfirm = !confirmed && !reasonMissing && !typedMismatch && inputError === null && choiceError === null
  const blockedBy = reasonMissing ? hintId : typedMismatch ? typedHintId : inputError !== null ? inputErrorId : choiceError !== null ? choiceErrorId : undefined

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setReasonText('')
      setTypedText('')
      setValue(input?.initial ?? '')
      setPicked(choice?.initial ?? '')
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
        <p>{typeof consequence === 'function' ? consequence(value, picked) : consequence}</p>
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
      {choice && (
        <div className="df-field">
          <label htmlFor={choiceId}>{choice.label}</label>
          <select
            id={choiceId}
            aria-invalid={choiceError !== null}
            aria-describedby={choiceError !== null ? choiceErrorId : undefined}
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
          >
            {choice.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {choiceError !== null && (
            <p id={choiceErrorId} className="df-field-hint">
              {choiceError}
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
            onConfirm(reason ? reasonText.trim() : null, input ? value : null, choice ? picked : null)
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
