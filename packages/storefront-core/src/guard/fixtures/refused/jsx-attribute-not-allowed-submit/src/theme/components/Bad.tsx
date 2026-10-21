import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <button type="submit">{t('pages.home.title')}</button>
}
