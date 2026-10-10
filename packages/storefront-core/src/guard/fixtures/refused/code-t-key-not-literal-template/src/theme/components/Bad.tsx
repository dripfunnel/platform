import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const part = 'home'
  return <p>{t(`pages.${part}.title`)}</p>
}
