import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  let badge = 'New'
  badge = badge + ''
  return <p>{badge}</p>
}
