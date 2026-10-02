import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { messages } from '../../messages'
import './detail.css'

export interface MoreActionsProps {
  // Each item closes the panel as it runs, through this callback.
  children: (close: () => void) => ReactNode
}

// The prototype's "Actions ▾" as a disclosure: a button that shows and hides the rest of a
// record's actions, closed again by Escape with focus back on the button.
export const MoreActions = ({ children }: MoreActionsProps) => {
  const id = useId()
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      toggleRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="df-more">
      <button ref={toggleRef} type="button" className="df-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((current) => !current)}>
        {messages.common.moreActions} <span aria-hidden="true">▾</span>
      </button>
      <div id={id} className="df-more-panel" hidden={!open}>
        {children(() => setOpen(false))}
      </div>
    </div>
  )
}
