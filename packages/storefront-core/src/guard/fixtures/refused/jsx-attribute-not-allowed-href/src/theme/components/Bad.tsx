import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <div onClick={undefined} {...{ href: 'x' }}>{t('pages.home.title')}</div>
}
