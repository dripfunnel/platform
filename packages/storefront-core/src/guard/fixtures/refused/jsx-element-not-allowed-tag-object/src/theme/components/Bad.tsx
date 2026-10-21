import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const Tags = { a: 'iframe' } as const
  return <Tags.a />
}
