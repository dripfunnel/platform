import * as React from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const el = React.useId()
  return <p>{t('pages.home.title')}</p>
}
