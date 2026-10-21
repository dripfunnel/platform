'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const find = (e: { currentTarget: HTMLElement }) => e.currentTarget.closest('main')
  return <p>{t('pages.home.title')}</p>
}
