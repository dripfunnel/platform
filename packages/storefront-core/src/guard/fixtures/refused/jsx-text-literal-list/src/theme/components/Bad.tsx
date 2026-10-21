import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const tags = ['New', 'Hot']
  return <ul>{tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>
}
