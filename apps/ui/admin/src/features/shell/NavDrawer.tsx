import { useEffect, useRef, type ReactNode } from 'react'
import { messages } from '../../messages'
import { Icon } from './Icon'
import { isBackdropClick } from './isBackdropClick'
import './shell.css'

const words = messages.shell

// The phone's side bar (design.md §4): a modal <dialog>, so the page behind is inert, Esc
// closes it and its ::backdrop is the scrim. A tap on the scrim closes it too.
export const NavDrawer = ({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="df-drawer"
      aria-label={words.navLabel}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={() => triggerRef.current?.focus()}
      onClick={(event) => {
        if (isBackdropClick(event)) onClose()
      }}
    >
      <button type="button" className="df-drawer-close" aria-label={words.closeMenu} onClick={onClose}>
        <Icon name="close" size={20} />
      </button>
      {children}
    </dialog>
  )
}
