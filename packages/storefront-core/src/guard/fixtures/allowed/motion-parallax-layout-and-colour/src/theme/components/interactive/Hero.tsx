'use client'

import { AnimatePresence, animate, motion, stagger, useAnimate, useMotionValue, useScroll, useSpring, useTransform } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

const list = { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { delayChildren: stagger(0.05) } } }
const item = { hidden: { opacity: 0, y: 12, backgroundColor: '#f4efe8' }, shown: { opacity: 1, y: 0, backgroundColor: '#fbf8f4' } }

export const Hero = ({ children }: { children: ReactNode }) => {
  const { t } = useStorefront()
  const hero = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: hero })
  const y = useTransform(scrollYProgress, [0, 1], ['0%', '30%'])
  const shade = useTransform(scrollYProgress, [0, 1], ['rgb(0 0 0 / 0)', 'rgb(0 0 0 / 0.4)'])
  const tilt = useMotionValue(0)
  const rotate = useSpring(tilt, { stiffness: 200, damping: 20 })
  const [scope, run] = useAnimate()
  const [open, setOpen] = useState(false)

  const press = () => {
    setOpen(!open)
    void animate(tilt, open ? 0 : 4, { duration: 0.4 })
    void run(scope.current, { boxShadow: '0 8px 24px #0003', clipPath: 'inset(0 0 0 0)' })
    if (hero.current) void animate(hero.current, { backgroundColor: '#1d1b18', color: '#fbf8f4' }, { duration: 0.3 })
  }

  return (
    <div ref={hero}>
      <motion.div style={{ y, backgroundColor: shade, rotate }} layout>
        {children}
      </motion.div>
      <button ref={scope} type="button" aria-expanded={open} onClick={press}>
        {t('pages.home.more')}
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul variants={list} initial="hidden" animate="shown" exit="hidden" layoutId="story">
            <motion.li variants={item} whileHover={{ boxShadow: '0 2px 8px #00000026', color: '#1d1b18' }}>
              {t('pages.home.story')}
            </motion.li>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
