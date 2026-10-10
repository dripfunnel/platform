import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const say: (key: string) => string = t
  return <p>{say('pages.home.title')}</p>
}
