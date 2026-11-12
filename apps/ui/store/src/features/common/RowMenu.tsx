import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import './rowMenu.css'

export interface RowMenuProps {
  /** The button's spoken label, already filled: "More actions for Mara Linen Shirt". */
  label: string
  /** Each item closes the menu as it runs, through this callback. */
  children: (close: () => void) => ReactNode
}

type Place = { top?: number; bottom?: number; right: number }

// The panel is fixed to the window, placed from the button, so a table's scroll area never clips it.
const placeOf = (button: HTMLElement): Place => {
  const box = button.getBoundingClientRect()
  const right = window.innerWidth - box.right
  return box.bottom > window.innerHeight - 140 ? { bottom: window.innerHeight - box.top + 4, right } : { top: box.bottom + 4, right }
}

/** A row's "⋮" button and its menu: Escape or a click outside closes it, and focus goes back to the button. */
export const RowMenu = ({ label, children }: RowMenuProps) => {
  const id = useId()
  const [place, setPlace] = useState<Place | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const open = place !== null
  const close = () => setPlace(null)

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !button.current?.contains(event.target)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
      button.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
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
