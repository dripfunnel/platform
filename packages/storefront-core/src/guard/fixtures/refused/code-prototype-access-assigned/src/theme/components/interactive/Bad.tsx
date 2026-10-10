'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

let maker: object = {}
const take = (x: object) => {
  ;({ constructor: maker } = x)
}
export const Bad = () => {
  const { t } = useStorefront()
  take({})
  return <p data-n={String(Boolean(maker))}>{t('pages.home.title')}</p>
}
