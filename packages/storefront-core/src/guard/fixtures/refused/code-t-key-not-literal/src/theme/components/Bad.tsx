import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = ({ key }: { key: string }) => {
  const { t } = useStorefront()
  return <p>{t(key)}</p>
}
