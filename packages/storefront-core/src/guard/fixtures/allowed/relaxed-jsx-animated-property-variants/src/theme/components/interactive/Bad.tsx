'use client'

import { motion } from 'motion/react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const shown = { open: { height: 200 }, shut: { height: 0 } }
  return <motion.div variants={shown}>{t('pages.home.title')}</motion.div>
}
