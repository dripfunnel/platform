import { Image, Link, Price, useStorefront, type ProductCard as Card } from '@dripfunnel/storefront-core/theme'
import { shop as styles } from './styles/shop'

export const ProductCard = ({ product }: { product: Card }) => {
  const { store, locale, t } = useStorefront()
  return (
    <article className={styles.card}>
      <Link href={product.href} className={styles.cardLink}>
        <div className={styles.cardPicture}>
          {product.photo ? <Image image={product.photo} alt={product.photo.alt ?? product.name} ratio={1} sizes="(min-width: 1100px) 200px, (min-width: 600px) 30vw, 50vw" className={styles.cardImage} /> : <span className={styles.noPicture}>{t('shop.card.noPicture')}</span>}
          {product.badges[0] ? <span className={styles.badge}>{product.badges[0].label}</span> : null}
          {product.stock.inStock ? null : <span className={styles.soldOut}>{t('shop.card.soldOut')}</span>}
        </div>
        <h3 className={styles.cardName}>{product.name}</h3>
      </Link>
      <div className={styles.cardFoot}>
        {product.price ? (
          <p className={styles.cardPrice}>
            {product.from ? <span className={styles.from}>{t('shop.card.from')}</span> : null}
            <Price money={product.price} compareAt={product.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} className={styles.price} />
          </p>
        ) : null}
        <span className={styles.cardAdd} aria-hidden="true">
          {t('shop.card.view')}
          <svg className={styles.cardAddIcon} viewBox="0 0 24 24" focusable="false">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
      </div>
    </article>
  )
}

/** `placeholders`: that many cells shaped like the placeholder's, after the products, while more load. */
export const ProductGrid = ({ products, wide = false, placeholders = 0 }: { products: readonly Card[]; wide?: boolean; placeholders?: number }) => (
  <ul className={wide ? styles.gridWide : styles.grid} aria-busy={placeholders > 0 || undefined}>
    {products.map((p) => (
      <li key={p.id} className={styles.cell}>
        <ProductCard product={p} />
      </li>
    ))}
    {[...Array(placeholders).keys()].map((i) => (
      <li key={i} className={styles.cell}>
        <div className={styles.skeletonCard}>
          <div className={styles.skeletonPicture} />
          <div className={styles.skeletonLine} />
        </div>
      </li>
    ))}
  </ul>
)

/** The grid's shape while its products load, so nothing moves when they arrive; `list` and `cell` match the loaded grid. */
export const GridPlaceholder = ({ label, count, list = styles.grid, cell = styles.cell }: { label: string; count: number; list?: string; cell?: string }) => (
  <ul className={list} aria-busy="true" aria-label={label}>
    {[...Array(count).keys()].map((i) => (
      <li key={i} className={cell}>
        <div className={styles.skeletonCard}>
          <div className={styles.skeletonPicture} />
          <div className={styles.skeletonLine} />
        </div>
      </li>
    ))}
  </ul>
)
