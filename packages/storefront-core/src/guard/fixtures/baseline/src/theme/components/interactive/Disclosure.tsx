'use client'

import { clsx } from 'clsx'
import { motion } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import styles from '../../styles/disclosure.module.css'

export const Disclosure = ({ label, children }: { label: string; children: ReactNode }) => {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const toggle = () => {
    setOpen(!open)
    button.current?.focus()
  }
  return (
    <div className={styles.disclosure}>
      <button ref={button} type="button" className={styles.toggle} aria-expanded={open} onClick={toggle}>
        {label}
      </button>
      <motion.div className={clsx(styles.panel, open && styles.open)} initial={{ opacity: 0 }} animate={{ opacity: open ? 1 : 0, y: open ? 0 : 8 }}>
        {children}
      </motion.div>
    </div>
  )
}
