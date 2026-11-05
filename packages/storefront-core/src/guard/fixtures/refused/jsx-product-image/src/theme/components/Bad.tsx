import { Link, MerchantImage, useProducts, useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const { products } = useProducts({ sort: 'newest', first: 4 })
  return (
    <ul>
      {products.map((product) => (
        <li key={product.id}>
          <MerchantImage asset={t('pages.home.lead')} alt={t('pages.home.title')} ratio={1} />
          <Link href={product.href}>{product.name}</Link>
        </li>
      ))}
    </ul>
  )
}
