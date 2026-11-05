import { Image, Link, MerchantImage, useProducts, useStorefront, type ProductCard } from '@dripfunnel/storefront-core/theme'
import styles from '../styles/hero.module.css'

const Card = ({ product }: { product: ProductCard }) => (
  <li className={styles.card}>
    {product.photo ? <Image image={product.photo} alt={product.name} ratio={1} /> : null}
    <Link href={product.href}>{product.name}</Link>
  </li>
)

export const Grid = () => {
  const { t } = useStorefront()
  const { products } = useProducts({ sort: 'best-selling' })
  return (
    <section className={styles.hero}>
      <MerchantImage asset={t('pages.home.lead')} alt={t('pages.home.title')} ratio={2} />
      <ul>
        {products.map((product) => (
          <Card key={product.id} product={product} />
        ))}
      </ul>
    </section>
  )
}
