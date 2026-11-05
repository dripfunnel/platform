import { Link, useProducts } from '@dripfunnel/storefront-core/theme'
import styles from '../styles/tile.module.css'

export const Bad = () => {
  const { products } = useProducts()
  return (
    <ul className={styles.tile}>
      {products.map((product) => (
        <li key={product.id} className={styles.picture}>
          <Link href={product.href}>{product.name}</Link>
        </li>
      ))}
    </ul>
  )
}
