import { Image, Link, useCollections, useProducts, useStorefront } from '@dripfunnel/storefront-core/theme'
import { ProductGrid } from '../components/ProductCard'
import { Layout } from '../components/Layout'
import shop from '../styles/shop.module.css'
import styles from '../styles/home.module.css'

export const HomePage = () => {
  const { store, t } = useStorefront()
  const { collections } = useCollections({ first: 4 })
  const newest = useProducts({ sort: 'newest', first: 4 })
  return (
    <Layout>
      <section className={styles.hero}>
        <div className={styles.copy}>
          <h1 className={styles.title}>{t('home.hero.title', { store: store.name })}</h1>
          <p className={styles.lead}>{store.description ?? t('home.hero.lead')}</p>
          <Link href="/search/" className={styles.button}>
            {t('home.hero.shop')}
          </Link>
        </div>
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('home.story.title')}</h2>
        <p className={styles.body}>{t('home.story.body')}</p>
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('home.contact.title')}</h2>
        <p className={styles.body}>{t('home.contact.body')}</p>
        <Link href="/contact/" className={styles.button}>
          {t('home.contact.action')}
        </Link>
      </section>
      {collections.length ? (
        <section className={shop.band}>
          <h2 className={shop.heading}>{t('home.collections.title')}</h2>
          <ul className={styles.tiles}>
            {collections.map((c) => (
              <li key={c.id}>
                <Link href={c.href} className={styles.tile}>
                  {c.image ? <Image image={c.image} alt={c.name} ratio={1} sizes="(min-width: 900px) 25vw, 50vw" className={styles.tileImage} /> : null}
                  <span className={styles.tileName}>{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {newest.products.length ? (
        <section className={shop.band}>
          <div className={shop.bandHead}>
            <h2 className={shop.heading}>{t('home.newest.title')}</h2>
            <Link href="/collections/all/?sort=newest" className={shop.textLink}>
              {t('home.newest.all')}
            </Link>
          </div>
          <ProductGrid products={newest.products} />
        </section>
      ) : null}
    </Layout>
  )
}
