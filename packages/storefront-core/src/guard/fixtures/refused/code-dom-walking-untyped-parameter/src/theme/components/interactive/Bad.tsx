'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

const pin = (target) => target
export const Bad = () => {
  const { t } = useStorefront()
  return <p data-pin={String(pin(1))}>{t('pages.home.title')}</p>
}
