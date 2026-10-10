import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const cdn = 'https://cdn.example.com/a.js'
  return <p>{t('pages.home.title')}</p>
}
