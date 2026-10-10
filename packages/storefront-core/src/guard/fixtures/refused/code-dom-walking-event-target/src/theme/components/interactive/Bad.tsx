'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const peek = (e: { target: EventTarget }) => (e.target as unknown as { remove: () => void }).remove()
  return <p>{t('pages.home.title')}</p>
}
