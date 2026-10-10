'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

let maker: object = {}
const take = (x: object, k: string) => {
  ;({ [k]: maker } = x as Record<string, object>)
}
export const Bad = () => {
  const { t } = useStorefront()
  take({}, 'a')
  return <p data-n={String(Boolean(maker))}>{t('pages.home.title')}</p>
}
