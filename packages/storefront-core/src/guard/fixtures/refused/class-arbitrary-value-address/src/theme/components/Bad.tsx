import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className="[mask-image:image-set('//cdn.example/a.png'_1x)]">{t('pages.home.title')}</p>
}
