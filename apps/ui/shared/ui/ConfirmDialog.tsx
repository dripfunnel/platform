import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import './states.css'

export interface ConfirmChoice {
  key: string
  label: string
  options: readonly { value: string; label: string }[]
  initial: string
  error: (picked: string, all: Readonly<Record<string, string>>) => string | null
  // Shown only while this holds for the other picks, such as a target plan once "move" is picked.
  when?: (all: Readonly<Record<string, string>>) => boolean
}

export interface ConfirmDialogProps {
  open: boolean
  title: string
  target: string
  // A function when the consequence depends on the value typed or picked, as a new trial end does.
  consequence: string | ((value: string, choices: Readonly<Record<string, string>>) => string)
  confirmLabel: string
  cancelLabel: string
  notes?: string[]
  reason?: { label: string; hint: string; placeholder?: string }
  typeToConfirm?: { label: string; hint: string; expected: string }
  // design.md §4's single-field ask: a value the action needs, such as a date. `error` says
  // what is wrong with the value, or null once it will do.
  input?: {
    label: string
    type: 'text' | 'date' | 'email' | 'password'
    initial: string
    placeholder?: string
    error: (value: string) => string | null
  }
  // Picks from short lists, such as a role, or a plan and when it applies (#116). `error` says why a pick won't do, or null.
  choices?: readonly ConfirmChoice[]
  danger?: boolean
  // Fields of the caller's own, kept by the caller, shown above the reason (a partner's contract).
  children?: ReactNode
  // Why those fields won't do yet, or null once they will: confirm waits for them as it does for `input`.
  blocked?: string | null
  // Why the last confirm failed, cleared by the caller as it confirms again: the dialog stays open with what was entered.
  error?: string | null
  onConfirm: (reason: string | null, value: string | null, choices: Readonly<Record<string, string>>) => void
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
  choices = [],
  danger = false,
  children,
  blocked = null,
  error = null,
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
  const choicesId = useId()
  const blockedId = useId()
  const [reasonText, setReasonText] = useState('')
  const [typedText, setTypedText] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [value, setValue] = useState('')
  const [picked, setPicked] = useState<Readonly<Record<string, string>>>({})
  const reasonMissing = reason !== undefined && reasonText.trim() === ''
  const typedMismatch = typeToConfirm !== undefined && typedText.trim() !== typeToConfirm.expected
  const inputError = input ? input.error(value) : null
  const picks: Readonly<Record<string, string>> = { ...Object.fromEntries(choices.map((choice) => [choice.key, choice.initial])), ...picked }
  const shown = choices.filter((choice) => choice.when?.(picks) ?? true)
  const choiceErrors = shown.map((choice) => choice.error(picks[choice.key] ?? '', picks))
  const failingChoice = choiceErrors.findIndex((error) => error !== null)
  const canConfirm = !confirmed && blocked === null && !reasonMissing && !typedMismatch && inputError === null && failingChoice === -1
  const blockedBy = blocked !== null ? blockedId : reasonMissing ? hintId : typedMismatch ? typedHintId : inputError !== null ? inputErrorId : failingChoice >= 0 ? `${choicesId}-${failingChoice}-error` : undefined

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setReasonText('')
      setTypedText('')
      setValue(input?.initial ?? '')
      setPicked({})
      setConfirmed(false)
      dialog.showModal()
      cancelRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    if (error !== null) setConfirmed(false)
  }, [error])

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
        <p>{typeof consequence === 'function' ? consequence(value, picks) : consequence}</p>
        {notes && notes.length > 0 && (
          <ul className="df-dialog-notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
      {children}
      {blocked !== null && (
        <p id={blockedId} className="df-field-hint">
          {blocked}
        </p>
      )}
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
            autoComplete={input.type === 'password' ? 'current-password' : undefined}
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
      {shown.map((choice, index) => {
        const error = choiceErrors[index] ?? null
        const id = `${choicesId}-${index}`
        return (
          <div key={choice.key} className="df-field">
            <label htmlFor={id}>{choice.label}</label>
            <select
              id={id}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? `${id}-error` : undefined}
              value={picks[choice.key] ?? ''}
              onChange={(event) => setPicked((current) => ({ ...current, [choice.key]: event.target.value }))}
            >
              {choice.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {error !== null && (
              <p id={`${id}-error`} className="df-field-hint">
                {error}
              </p>
            )}
          </div>
        )
      })}
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
      {error !== null && (
        <p className="df-field-hint" role="alert">
          {error}
        </p>
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
            onConfirm(reason ? reasonText.trim() : null, input ? value : null, picks)
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
