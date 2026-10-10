import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const key = 'pages.home.title'
  return <p>{t(key)}</p>
}
