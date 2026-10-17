'use client'

import { useRef, useState } from 'react'
import { Link, useStorefront, type MenuItem } from '@dripfunnel/storefront-core/theme'
import styles from '../../styles/layout.module.css'

export const NavItem = ({ item }: { item: MenuItem }) => {
  const { t } = useStorefront()
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hovered = useRef(false)
  const focused = useRef(false)
  const show = (value: boolean) => {
    clearTimeout(leaving.current)
    setOpen(value)
  }
  return (
    <div
      className={styles.navItem}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        show(false)
        toggle.current?.focus()
      }}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        hovered.current = true
        show(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return
        hovered.current = false
        if (!focused.current) show(false)
      }}
      onFocus={(e) => {
        focused.current = true
        if (e.target === (toggle.current as EventTarget | null)) clearTimeout(leaving.current)
        else show(true)
      }}
      onBlur={() => {
        focused.current = false
        leaving.current = setTimeout(() => setOpen(false), 0)
      }}
    >
      <Link href={item.href} className={styles.navLink}>
        {item.label}
      </Link>
      {item.children.length ? (
        <>
          <button ref={toggle} type="button" className={styles.subToggle} aria-expanded={open} aria-label={t('common.nav.submenu', { item: item.label })} onClick={() => show(hovered.current || !open)}>
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div className={open ? `${styles.subnav} ${styles.subnavOpen}` : styles.subnav}>
            {item.children.map((child) => (
              <Link key={child.id} href={child.href} className={styles.subLink}>
                {child.label}
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
