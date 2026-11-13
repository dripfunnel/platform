import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import './rowMenu.css'

export interface RowMenuProps {
  /** The button's spoken label, already filled: "More actions for Mara Linen Shirt". */
  label: string
  /** Each item closes the menu as it runs, through this callback; focus goes back to the ⋮ button. */
  children: (close: () => void) => ReactNode
}

type Place = { top?: number; bottom?: number; right: number }

// The panel is fixed to the window, placed from the button, so a table's scroll area never clips it.
const placeOf = (button: HTMLElement): Place => {
  const box = button.getBoundingClientRect()
  const right = window.innerWidth - box.right
  return box.bottom > window.innerHeight - 140 ? { bottom: window.innerHeight - box.top + 4, right } : { top: box.bottom + 4, right }
}

/** A row's "⋮" button and its menu: arrows, Home and End move between items; Escape, Tab or choosing an item closes it with focus on the button. */
export const RowMenu = ({ label, children }: RowMenuProps) => {
  const id = useId()
  const [place, setPlace] = useState<Place | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const open = place !== null
  const close = () => {
    setPlace(null)
    button.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const away = () => setPlace(null)
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !button.current?.contains(event.target)) away()
    }
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') return close()
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
      const at = items.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : step === undefined ? -1 : (at + step + items.length) % items.length
      if (next < 0 || items.length === 0) return
      event.preventDefault()
      items[next]?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keys)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', away, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', keys)
      window.removeEventListener('resize', away)
      window.removeEventListener('scroll', away, true)
    }
  }, [open])

  return (
    <span className="df-row-menu">
      <button ref={button} type="button" className="df-row-menu-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => (open ? close() : button.current && setPlace(placeOf(button.current)))}>
        <span aria-hidden="true">⋮</span>
      </button>
      {open && (
        <div ref={panel} id={id} role="menu" className="df-row-menu-panel" style={place}>
          {children(close)}
        </div>
      )}
    </span>
  )
}
