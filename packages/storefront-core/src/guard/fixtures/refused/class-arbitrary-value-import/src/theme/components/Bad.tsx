import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className="[--hero:@import_'x.css']">{t('pages.home.title')}</p>
}
