import type { ProductCard } from '@dripfunnel/storefront-core/theme'
import { Link } from '@dripfunnel/storefront-core/theme'
import { Art } from './Art'

export const Bad = ({ product }: { product: ProductCard }) => (
  <article>
    <Link href={product.href}>{product.name}</Link>
    <Art />
  </article>
)
