import { Image, Link, useCollections, useProducts, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { GridPlaceholder, ProductGrid } from '../components/ProductCard'
import shop from '../styles/shop.module.css'
import styles from '../styles/home.module.css'

export const HomePage = () => {
  const { store, t } = useStorefront()
  const { collections, status } = useCollections({ first: 4 })
  const newest = useProducts({ sort: 'newest', first: 4 })
  return (
    <Layout>
      <section className={styles.hero}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>{t('home.hero.eyebrow')}</p>
          <h1 className={styles.title}>{t('home.hero.title', { store: store.name })}</h1>
          <p className={styles.lead}>{store.description ?? t('home.hero.lead')}</p>
          <div className={styles.actions}>
            <Link href="/collections/all/" className={styles.button}>
              {t('home.hero.shop')}
            </Link>
            <Link href="/about/" className={styles.ghost}>
              {t('home.hero.story')}
            </Link>
          </div>
        </div>
        <div className={styles.picture} />
      </section>
      <section className={styles.story}>
        <div className={styles.storyPicture} />
        <div className={styles.storyCopy}>
          <p className={styles.eyebrow}>{t('home.story.eyebrow')}</p>
          <h2 className={styles.heading}>{t('home.story.title')}</h2>
          <p className={styles.body}>{t('home.story.body')}</p>
          <Link href="/about/" className={styles.ghost}>
            {t('home.story.more')}
          </Link>
        </div>
      </section>
      <section className={styles.signup}>
        <h2 className={styles.heading}>{t('home.signup.title')}</h2>
        <p className={styles.body}>{t('home.signup.body')}</p>
        <Link href="/register/" className={styles.button}>
          {t('home.signup.action')}
        </Link>
      </section>
      {status === 'loading' || collections.length ? (
        <section className={shop.band}>
          <h2 className={shop.heading}>{t('home.collections.title')}</h2>
          {status === 'loading' ? (
            <ul className={styles.tiles} aria-busy="true" aria-label={t('shop.listing.loading')}>
              {[0, 1, 2, 3].map((i) => (
                <li key={i}>
                  <span className={styles.tile} />
                </li>
              ))}
            </ul>
          ) : (
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
          )}
        </section>
      ) : null}
      {newest.status === 'loading' || newest.products.length ? (
        <section className={shop.band}>
          <div className={shop.bandHead}>
            <h2 className={shop.heading}>{t('home.newest.title')}</h2>
            <Link href="/collections/all/?sort=newest" className={shop.textLink}>
              {t('home.newest.all')}
            </Link>
          </div>
          {newest.status === 'loading' ? <GridPlaceholder label={t('shop.listing.loading')} count={4} /> : <ProductGrid products={newest.products} />}
        </section>
      ) : null}
    </Layout>
  )
}
