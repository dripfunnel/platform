import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const bot = navigator.webdriver
  return <p>{t('pages.home.title')}</p>
}
