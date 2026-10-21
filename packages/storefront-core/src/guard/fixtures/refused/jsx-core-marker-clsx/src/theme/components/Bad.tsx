import { clsx } from 'clsx'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className={clsx('df-banner')}>{t('pages.home.title')}</p>
}
