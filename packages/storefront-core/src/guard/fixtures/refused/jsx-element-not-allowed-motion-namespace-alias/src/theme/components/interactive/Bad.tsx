'use client'

import { motion } from 'motion/react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const M = motion
  return <M.a>{t('pages.home.title')}</M.a>
}
