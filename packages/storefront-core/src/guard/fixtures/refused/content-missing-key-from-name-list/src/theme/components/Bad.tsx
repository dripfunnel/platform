import { useStorefront } from '@dripfunnel/storefront-core/theme'

const names = ['pages.home.title', 'pages.home.subtitle'] as const

export const Bad = () => {
  const { t } = useStorefront()
  return <p>{names.map((n) => t(n))}</p>
}
