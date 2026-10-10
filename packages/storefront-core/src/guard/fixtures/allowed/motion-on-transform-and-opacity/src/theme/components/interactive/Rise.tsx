'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

const shown = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }

export const Rise = ({ open, children }: { open: boolean; children: ReactNode }) => {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {open && (
        <motion.div variants={shown} initial="hidden" animate="visible" exit="hidden" whileHover={{ scale: reduced ? 1 : 1.02 }} drag="x" dragConstraints={{ left: 0, right: 0 }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
