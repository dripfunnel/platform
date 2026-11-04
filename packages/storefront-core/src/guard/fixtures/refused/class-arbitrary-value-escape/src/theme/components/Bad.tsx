import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className="bg-[u\72l(m_hero01)]">{t('pages.home.title')}</p>
}
