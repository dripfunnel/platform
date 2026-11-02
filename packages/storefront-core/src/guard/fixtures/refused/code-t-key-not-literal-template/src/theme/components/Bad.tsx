import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = ({ part }: { part: string }) => {
  const { t } = useStorefront()
  return <p>{t(`pages.${part}.title`)}</p>
}
