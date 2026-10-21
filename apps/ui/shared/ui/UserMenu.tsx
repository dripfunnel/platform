import { themeChoices } from './theme'
import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { initials } from './initials'
import './shell.css'
import { useTheme } from './useTheme'

export interface UserMenuWords {
  // The button's spoken label, already filled: "Account: Arjun Menon, Super admin".
  buttonLabel: string
  theme: { label: string; system: string; light: string; dark: string }
}

export interface UserMenuProps {
  name: string
  email: string
  roleLabel: string
  words: UserMenuWords
  themeStorageKey: string
  // The app's own entries after Appearance (My activity, Sign out), drawn as menu items.
  items: readonly UserMenuItem[]
}

export interface UserMenuItem {
  key: string
  label: string
  to: string
  search?: Record<string, string>
  // Runs instead of following `to`, which stays the link's address (Sign out ends the session first).
  onSelect?: () => void
}

export const UserMenu = ({ name, email, roleLabel, words, themeStorageKey, items }: UserMenuProps) => {
  const [open, setOpen] = useState(false)
  const { choice, setChoice } = useTheme(themeStorageKey)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // The first item in the menu, focused on open. It is the first Appearance option.
  const itemRef = useRef<HTMLButtonElement>(null)
  const buttonId = useId()
  const menuId = useId()
  const themeId = useId()

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
        aria-label={words.buttonLabel}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="df-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="df-user-text" aria-hidden="true">
          <span className="df-user-name">{name}</span>
          <span className="df-user-role">{roleLabel}</span>
        </span>
        <svg className="df-user-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open && (
        <div className="df-user-menu" id={menuId}>
          <div className="df-user-identity">
            <p className="df-user-identity-name">{name}</p>
            <p>{email}</p>
            <p>{roleLabel}</p>
          </div>
          <ul role="menu" aria-labelledby={buttonId}>
            <li role="none">
              <p className="df-user-menu-label" id={themeId}>
                {words.theme.label}
              </p>
              <div role="group" aria-labelledby={themeId} className="df-user-theme">
                {themeChoices.map((option, index) => (
                  <button
                    key={option}
                    ref={index === 0 ? itemRef : undefined}
                    type="button"
                    role="menuitemradio"
                    aria-checked={choice === option}
                    className="df-user-theme-option"
                    onClick={() => setChoice(option)}
                  >
                    {words.theme[option]}
                  </button>
                ))}
              </div>
            </li>
            {items.map((item) => (
              <li key={item.key} role="none">
                <Link
                  to={item.to}
                  {...(item.search ? { search: item.search } : {})}
                  role="menuitem"
                  className="df-user-menu-item"
                  onClick={(event) => {
                    setOpen(false)
                    if (!item.onSelect) return
                    event.preventDefault()
                    item.onSelect()
                  }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
