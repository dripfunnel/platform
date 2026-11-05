import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className="bg-[url(https://cdn.example/a.png)]">{t('pages.home.title')}</p>
}
