import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './detail.css'

export interface MoreActionsProps {
  label: string
  // Each item closes the panel as it runs, through this callback.
  children: (close: () => void) => ReactNode
}

// The prototype's "Actions ▾" as a disclosure: a button that shows and hides the rest of a
// record's actions, closed again by Escape with focus back on the button.
export const MoreActions = ({ label, children }: MoreActionsProps) => {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Opens above the button only when the window has no room below and does above (#1651).
  useLayoutEffect(() => {
    const panel = panelRef.current
    const toggle = toggleRef.current
    if (!open || !panel || !toggle) {
      setUp(false)
      return
    }
    const below = panel.getBoundingClientRect()
    const button = toggle.getBoundingClientRect()
    const above = button.top - (below.top - button.bottom)
    setUp(below.bottom > window.innerHeight && above >= below.height)
  }, [open])

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
        {label} <span aria-hidden="true">▾</span>
      </button>
      <div ref={panelRef} id={id} className={up ? 'df-more-panel df-more-panel--up' : 'df-more-panel'} hidden={!open}>
        {children(() => setOpen(false))}
      </div>
    </div>
  )
}
