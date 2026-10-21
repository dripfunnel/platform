import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const send = () => fetch('/api/x')
  return <p>{t('pages.home.title')}</p>
}
