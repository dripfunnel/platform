import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import type { Me } from '../../api/me'
import { fill, messages } from '../../messages'
import { initials } from './initials'
import './shell.css'

const words = messages.shell

// Sign out only: the prototype's "My activity" opens the Activity log, which is (proposed)
// in FIRST-RELEASE.md §2.
export const UserMenu = ({ me }: { me: Me }) => {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRef = useRef<HTMLAnchorElement>(null)
  const buttonId = useId()
  const menuId = useId()
  const role = words.roles[me.role]

  useEffect(() => {
    if (!open) return
    itemRef.current?.focus()
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="df-user" ref={wrapperRef}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className="df-user-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={fill(words.userMenu.label, { name: me.name, role })}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="df-avatar" aria-hidden="true">
          {initials(me.name)}
        </span>
        <span className="df-user-text" aria-hidden="true">
          <span className="df-user-name">{me.name}</span>
          <span className="df-user-role">{role}</span>
        </span>
        <svg className="df-user-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open && (
        <div className="df-user-menu" id={menuId}>
          <div className="df-user-identity">
            <p className="df-user-identity-name">{me.name}</p>
            <p>{me.email}</p>
            <p>{role}</p>
          </div>
          <ul role="menu" aria-labelledby={buttonId}>
            <li role="none">
              {/* A stand-in: it ends no session and logs nothing. #13 adds the Admin API's
                  sign-out, which ends the session and writes the activity log; call it here
                  (https://github.com/dripfunnel/platform/issues/13). */}
              <Link
                ref={itemRef}
                to="/sign-in"
                role="menuitem"
                className="df-user-menu-item"
                onClick={() => setOpen(false)}
              >
                {words.userMenu.signOut}
              </Link>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
