'use client'

import { useState } from 'react'
import { Link, type MenuItem } from '@dripfunnel/storefront-core/theme'
import styles from '../../styles/layout.module.css'

export const NavItem = ({ item, toggleLabel }: { item: MenuItem; toggleLabel: string }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.navItem} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <Link href={item.href} className={styles.navLink}>
        {item.label}
      </Link>
      {item.children.length ? (
        <>
          <button type="button" className={styles.subToggle} aria-expanded={open} aria-label={`${toggleLabel}: ${item.label}`} onClick={() => setOpen(!open)}>
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
