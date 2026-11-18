import { Image, Link, ThemeImage, useCollections, useProducts, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { GridPlaceholder, ProductGrid } from '../components/ProductCard'
import { Ornament } from '../components/Ornament'
import { home as styles } from '../components/styles/home'

const Rule = () => <Ornament className={styles.ornament} />

const Heading = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
  <div className={styles.head}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h2 className={styles.heading}>{title}</h2>
    <Rule />
  </div>
)

export const HomePage = () => {
  const { store, t } = useStorefront()
  const { collections, status } = useCollections({ first: 5 })
  const newest = useProducts({ sort: 'newest', first: 4 })
  const picks = useProducts({ sort: 'best-selling', first: 4 })

  return (
    <Layout>
      <section className={styles.hero}>
        <div className={styles.heroLeft}>
          <ThemeImage src="hero-choker.webp" alt={t('home.hero.altLeft')} ratio={0.75} sizes="(min-width: 900px) 30vw, 50vw" className={styles.image} />
        </div>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{t('home.hero.eyebrow')}</p>
          <h1 className={styles.heroTitle}>
            {t('home.hero.title')} <em className={styles.em}>{t('home.hero.accent')}</em>
          </h1>
          <Rule />
          <p className={styles.lead}>{store.description ?? t('home.hero.lead')}</p>
          <Link href="/collections/all/" className={styles.button}>
            {t('home.hero.action')}
          </Link>
        </div>
        <div className={styles.heroRight}>
          <ThemeImage src="hero-hands.webp" alt={t('home.hero.altRight')} ratio={0.75} sizes="(min-width: 900px) 30vw, 50vw" className={styles.image} />
        </div>
      </section>

      <ul className={styles.assure} aria-label={t('home.assure.label')}>
        <li className={styles.assureItem}>{t('home.assure.secure')}</li>
        <li className={styles.assureItem}>{t('home.assure.track')}</li>
        <li className={styles.assureItem}>{t('home.assure.save')}</li>
      </ul>

      {status === 'loading' || collections.length ? (
        <section className={styles.section}>
          <Heading eyebrow={t('home.collections.eyebrow')} title={t('home.collections.title')} />
          <ul className={styles.arches} aria-busy={status === 'loading' ? 'true' : undefined}>
            {status === 'loading'
              ? [0, 1, 2, 3].map((i) => (
                  <li key={i} className={styles.archItem}>
                    <span className={styles.archPicture} />
                  </li>
                ))
              : collections.map((c) => (
                  <li key={c.id} className={styles.archItem}>
                    <Link href={c.href} className={styles.arch}>
                      <span className={styles.archPicture}>{c.image ? <Image image={c.image} alt="" ratio={0.75} sizes="(min-width: 900px) 20vw, 50vw" className={styles.archImage} /> : null}</span>
                      <span className={styles.archName}>{c.name}</span>
                    </Link>
                  </li>
                ))}
          </ul>
          <Link href="/collections/all/" className={styles.textLink}>
            {t('home.collections.all')}
          </Link>
        </section>
      ) : null}

      {newest.status === 'loading' || newest.products.length ? (
        <section className={styles.section}>
          <Heading eyebrow={t('home.newest.eyebrow')} title={t('home.newest.title')} />
          {newest.status === 'loading' ? <GridPlaceholder label={t('shop.listing.loading')} count={4} wide /> : <ProductGrid products={newest.products} wide />}
          <Link href="/collections/all/?sort=newest" className={styles.ghost}>
            {t('home.newest.all')}
          </Link>
        </section>
      ) : null}

      <section className={styles.story}>
        <div className={styles.storyPicture}>
          <ThemeImage src="story-chain.webp" alt={t('home.story.alt')} ratio={0.8} sizes="(min-width: 900px) 40vw, 100vw" className={styles.image} />
        </div>
        <div className={styles.storyCopy}>
          <p className={styles.eyebrow}>{t('home.story.eyebrow')}</p>
          <h2 className={styles.storyTitle}>
            {t('home.story.title')} <em className={styles.em}>{t('home.story.accent')}</em>
          </h2>
          <p className={styles.body}>{t('home.story.body')}</p>
          <Link href="/about/" className={styles.textLink}>
            {t('home.story.more')}
          </Link>
        </div>
      </section>

      <section className={styles.gift}>
        <div className={styles.giftPicture}>
          <ThemeImage src="banner-ring.webp" alt={t('home.gift.alt')} ratio={1.5} sizes="(min-width: 1240px) 1176px, 100vw" className={styles.image} />
        </div>
        <div className={styles.giftCard}>
          <p className={styles.eyebrow}>{t('home.gift.eyebrow')}</p>
          <h2 className={styles.giftTitle}>
            {t('home.gift.title')} <em className={styles.em}>{t('home.gift.accent')}</em>
          </h2>
          <p className={styles.body}>{t('home.gift.body')}</p>
          <Link href="/collections/all/?sort=price-low" className={styles.button}>
            {t('home.gift.action')}
          </Link>
        </div>
      </section>

      {picks.status === 'loading' || picks.products.length ? (
        <section className={styles.section}>
          <Heading eyebrow={t('home.picks.eyebrow')} title={t('home.picks.title')} />
          {picks.status === 'loading' ? <GridPlaceholder label={t('shop.listing.loading')} count={4} wide /> : <ProductGrid products={picks.products} wide />}
          <Link href="/collections/all/" className={styles.ghost}>
            {t('home.picks.all')}
          </Link>
        </section>
      ) : null}

      <section className={styles.signup}>
        <Rule />
        <h2 className={styles.heading}>{t('home.signup.title')}</h2>
        <p className={styles.body}>{t('home.signup.body')}</p>
        <Link href="/register/" className={styles.button}>
          {t('home.signup.action')}
        </Link>
      </section>
    </Layout>
  )
}
