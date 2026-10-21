import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const make = (x: object) => x.constructor
  return <p>{t('pages.home.title')}</p>
}
