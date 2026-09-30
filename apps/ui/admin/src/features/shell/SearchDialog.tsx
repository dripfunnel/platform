import { useEffect, useId, useRef } from 'react'
import { messages } from '../../messages'
import '../common/states.css'
import { Icon } from './Icon'
import { isBackdropClick } from './isBackdropClick'
import './shell.css'

const words = messages.shell.search

// Opens and closes like the prototype's search (Esc or a click outside closes it); the search
// itself arrives with the Admin API's `search` query (FIRST-RELEASE.md §12, Header).
export const SearchDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const inputId = useId()
  const hintId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
      inputRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="df-search"
      aria-labelledby={`${inputId}-label`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={() => triggerRef.current?.focus()}
      onClick={(event) => {
        if (isBackdropClick(event)) onClose()
      }}
    >
      <div className="df-search-panel">
        <div className="df-search-field">
          <Icon name="search" />
          <label htmlFor={inputId} id={`${inputId}-label`} className="df-visually-hidden">
            {words.inputLabel}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="search"
            autoComplete="off"
            placeholder={words.placeholder}
            aria-describedby={hintId}
          />
          <button type="button" className="df-search-close" onClick={onClose}>
            <kbd aria-hidden="true">{words.escapeHint}</kbd>
            <span className="df-visually-hidden">{words.close}</span>
          </button>
        </div>
        <p id={hintId} className="df-search-hint">
          {words.notConnected}
        </p>
      </div>
    </dialog>
  )
}
