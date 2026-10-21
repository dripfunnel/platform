import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const write = 'hello@northstar.example'
  return <p>{t('pages.home.title')}</p>
}
