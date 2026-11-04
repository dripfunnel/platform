import { Image, Link, useListing, useStorefront, type CollectionCard } from '@dripfunnel/storefront-core/theme'
import { Ornament } from './Ornament'
import { ProductCard } from './ProductCard'
import { cx } from './cx'
import { slugOf } from './slugOf'
import art from '../styles/art.module.css'
import styles from '../styles/home.module.css'

type SpotlightProps = {
  collection: CollectionCard
  /** The class that paints the banner's placeholder until the collection has a picture. */
  picture: string | undefined
  /** The banner sits left of the products, or right of them from tablet width up. */
  end?: boolean
}

/**
 * A collection's banner beside four of its products, between two temple-border bands.
 * Hidden until the collection has products, so an empty collection leaves no gap.
 */
export const Spotlight = ({ collection, picture, end = false }: SpotlightProps) => {
  const { t } = useStorefront()
  const { items } = useListing({ collection: slugOf(collection) })
  if (!items.length) return null
  return (
    <section className={styles.spotlight}>
      <div className={styles.templeBorder} />
      <div className={cx(styles.spotlightInner, end && styles.spotlightEnd)}>
        <div className={styles.spotlightAside}>
          <div className={cx(styles.spotlightBanner, art.art, picture)}>
            {collection.image ? <Image image={collection.image} alt="" ratio={1} sizes="(min-width: 768px) 50vw, 100vw" className={styles.cover} /> : null}
            <span className={styles.spotlightFrame} />
            <div className={styles.spotlightCopy}>
              <p className={styles.spotlightEyebrow}>{t('home.spotlight.eyebrow')}</p>
              <h2 className={styles.spotlightTitle}>{collection.name}</h2>
              <Ornament className={styles.spotlightOrnament} />
              <p className={styles.spotlightBody}>{collection.description || t('home.spotlight.body')}</p>
              <Link href={collection.href} className={styles.taupeButton}>
                {t('home.spotlight.cta', { name: collection.name })}
              </Link>
            </div>
          </div>
        </div>
        <ul className={styles.spotlightGrid}>
          {items.slice(0, 4).map((product) => (
            <li key={product.id}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      </div>
      <div className={cx(styles.templeBorder, styles.templeBorderFlip)} />
    </section>
  )
}
