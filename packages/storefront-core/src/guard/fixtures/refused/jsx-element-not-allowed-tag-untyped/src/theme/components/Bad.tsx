import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const Frame = JSON.parse('0') as any
  return <Frame />
}
