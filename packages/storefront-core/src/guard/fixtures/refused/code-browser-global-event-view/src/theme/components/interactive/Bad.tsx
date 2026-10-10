'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const send = (e: { view: Window }) => e.view.postMessage('x', '*')
  return <button type="button" onClick={() => undefined}>{t('pages.home.title')}</button>
}
