'use client'

import { motion } from 'motion/react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const Frame = motion.create('iframe')
  return <Frame>{t('pages.home.title')}</Frame>
}
