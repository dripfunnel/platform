import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <div dangerouslySetInnerHTML={{ __html: t('pages.home.title') }} />
}
