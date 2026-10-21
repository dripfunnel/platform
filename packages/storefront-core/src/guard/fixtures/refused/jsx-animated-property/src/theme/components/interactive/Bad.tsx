'use client'

import { motion } from 'motion/react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <motion.div animate={{ width: 400 }}>{t('pages.home.title')}</motion.div>
}
