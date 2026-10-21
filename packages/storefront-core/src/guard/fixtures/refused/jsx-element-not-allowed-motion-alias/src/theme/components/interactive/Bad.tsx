'use client'

import { motion } from 'motion/react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const Go = motion.a
  return <Go>{t('pages.home.title')}</Go>
}
