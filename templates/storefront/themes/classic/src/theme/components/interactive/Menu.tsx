'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import styles from '../../styles/menu.module.css'

export const Menu = ({ label, children }: { label: string; children: ReactNode }) => {
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const close = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return
    setOpen(false)
    toggle.current?.focus()
  }
  return (
    <div className={styles.menu} onKeyDown={close}>
      <button ref={toggle} type="button" className={styles.toggle} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(!open)}>
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} />
        </svg>
        <span className={styles.label}>{label}</span>
      </button>
      <div id="site-menu" className={open ? styles.open : styles.panel}>
        {children}
      </div>
    </div>
  )
}
