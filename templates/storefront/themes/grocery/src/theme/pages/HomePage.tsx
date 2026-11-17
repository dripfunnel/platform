import type { ReactNode } from 'react'
import { Image, Link, ThemeImage, useCollections, useProducts, useStorefront, type ProductCard as Card } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { GridPlaceholder, ProductCard } from '../components/ProductCard'
import { home as styles } from '../components/styles/home'

const Arrow = () => (
  <svg className={styles.arrow} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 12h14 M13 6l6 6-6 6" />
  </svg>
)

const Grid = ({ products }: { products: readonly Card[] }) => (
  <ul className={styles.grid}>
    {products.map((p) => (
      <li key={p.id} className={styles.cell}>
        <ProductCard product={p} />
      </li>
    ))}
  </ul>
)

const Pledge = ({ icon, title, body }: { icon: ReactNode; title: string; body: string }) => (
  <li className={styles.promise}>
    <svg className={styles.promiseIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {icon}
    </svg>
    <div>
      <p className={styles.promiseTitle}>{title}</p>
      <p className={styles.promiseBody}>{body}</p>
    </div>
  </li>
)

export const HomePage = () => {
  const { store, t } = useStorefront()
  const { collections, status } = useCollections({ first: 11 })
  const newest = useProducts({ sort: 'newest', first: 6 })
  const budget = useProducts({ sort: 'price-low', first: 10 })
  const picks = useProducts({ sort: 'best-selling', first: 6 })

  return (
    <Layout>
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.intro}>
          <div className={styles.introCopy}>
            <p className={styles.introEyebrow}>{t('home.hero.eyebrow', { store: store.name })}</p>
            <h1 id="home-title" className={styles.title}>
              {t('home.hero.title')}
            </h1>
            <p className={styles.lead}>{t('home.hero.lead')}</p>
            <Link href="/search/" className={styles.introSearch}>
              {t('home.hero.search')} <Arrow />
            </Link>
          </div>
          <div className={styles.introPicture}>
            <ThemeImage src="hero-crate.webp" alt={t('home.hero.alt')} ratio={1.5} sizes="(min-width: 1100px) 420px, 300px" className={styles.introImage} />
          </div>
        </div>

        {status === 'loading' ? (
          <ul className={styles.tiles} aria-busy="true" aria-label={t('shop.listing.loading')}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i}>
                <span className={styles.placeholder} />
              </li>
            ))}
          </ul>
        ) : (
          <ul className={styles.tiles}>
            {collections.map((c) => (
              <li key={c.id}>
                <Link href={c.href} className={styles.tile}>
                  <span className={styles.tilePicture}>{c.image ? <Image image={c.image} alt="" ratio={1} sizes="(min-width: 900px) 160px, 25vw" className={styles.tileImage} /> : null}</span>
                  <span className={styles.tileName}>{c.name}</span>
                </Link>
              </li>
            ))}
            <li>
              <Link href="/collections/all/" className={styles.tile}>
                <span className={styles.allPicture} aria-hidden="true">
                  <svg className={styles.allIcon} viewBox="0 0 24 24" focusable="false">
                    <path d="M5 12h14 M13 6l6 6-6 6" />
                  </svg>
                  <span className={styles.allNote}>{t('home.hero.allBody')}</span>
                </span>
                <span className={styles.tileName}>{t('home.hero.all')}</span>
              </Link>
            </li>
          </ul>
        )}
      </section>

      <ul className={styles.promos} aria-label={t('home.promos.label')}>
        <li>
          <Link href="/collections/all/?sort=newest" className={styles.promoNew}>
            <span className={styles.promoCopy}>
              <span className={styles.promoEyebrow}>{t('home.promos.new.eyebrow')}</span>
              <span className={styles.promoTitle}>{t('home.promos.new.title')}</span>
              <span className={styles.promoActionLight}>
                {t('home.promos.new.action')} <Arrow />
              </span>
            </span>
            <span className={styles.promoPicture}>
              <ThemeImage src="promo-greens.webp" alt={t('home.promos.new.alt')} ratio={1} sizes="(min-width: 800px) 260px, 40vw" className={styles.promoImage} />
            </span>
          </Link>
        </li>
        <li>
          <Link href="/collections/all/?sort=price-low" className={styles.promoValue}>
            <span className={styles.promoCopy}>
              <span className={styles.promoEyebrow}>{t('home.promos.value.eyebrow')}</span>
              <span className={styles.promoTitle}>{t('home.promos.value.title')}</span>
              <span className={styles.promoActionDark}>
                {t('home.promos.value.action')} <Arrow />
              </span>
            </span>
            <span className={styles.promoPicture}>
              <ThemeImage src="promo-spices.webp" alt={t('home.promos.value.alt')} ratio={1} sizes="(min-width: 800px) 260px, 40vw" className={styles.promoImage} />
            </span>
          </Link>
        </li>
      </ul>

      {newest.status === 'loading' || newest.products.length ? (
        <section className={styles.section}>
          <div className={styles.head}>
            <h2 className={styles.heading}>{t('home.newest.title')}</h2>
            <Link href="/collections/all/?sort=newest" className={styles.more}>
              {t('home.newest.all')} <Arrow />
            </Link>
          </div>
          {newest.status === 'loading' ? <GridPlaceholder label={t('shop.listing.loading')} count={6} /> : <Grid products={newest.products} />}
        </section>
      ) : null}

      {budget.products.length ? (
        <section className={styles.band}>
          <div className={styles.bandInner}>
            <div className={styles.head}>
              <div>
                <p className={styles.eyebrow}>{t('home.budget.eyebrow')}</p>
                <h2 className={styles.heading}>{t('home.budget.title')}</h2>
              </div>
              <Link href="/collections/all/?sort=price-low" className={styles.more}>
                {t('home.budget.all')} <Arrow />
              </Link>
            </div>
            <ul className={styles.rail} aria-label={t('home.budget.title')}>
              {budget.products.map((p) => (
                <li key={p.id} className={styles.railItem}>
                  <ProductCard product={p} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className={styles.story}>
        <div className={styles.storyInner}>
          <div className={styles.storyPicture}>
            <ThemeImage src="story-basket.webp" alt={t('home.story.alt')} ratio={1.15} sizes="(min-width: 800px) 42vw, 100vw" className={styles.storyImage} />
          </div>
          <div className={styles.storyCopy}>
            <p className={styles.eyebrow}>{t('home.story.eyebrow')}</p>
            <h2 className={styles.heading}>{t('home.story.title')}</h2>
            <p className={styles.storyBody}>{t('home.story.body')}</p>
            {collections.length ? <p className={styles.storyCount}>{t('home.story.collections', { count: collections.length })}</p> : null}
            <Link href="/about/" className={styles.storyLink}>
              {t('home.story.more')} <Arrow />
            </Link>
          </div>
        </div>
      </section>

      {picks.products.length ? (
        <section className={styles.section}>
          <div className={styles.head}>
            <h2 className={styles.heading}>{t('home.picks.title')}</h2>
            <Link href="/collections/all/" className={styles.more}>
              {t('home.picks.all')} <Arrow />
            </Link>
          </div>
          <Grid products={picks.products} />
        </section>
      ) : null}

      <section className={styles.promises} aria-label={t('home.promises.label')}>
        <ul className={styles.promiseList}>
          <Pledge
            title={t('home.promises.secure.title')}
            body={t('home.promises.secure.body')}
            icon={
              <>
                <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
                <path d="M8.5 10.5V7.5a3.5 3.5 0 017 0v3" />
              </>
            }
          />
          <Pledge
            title={t('home.promises.track.title')}
            body={t('home.promises.track.body')}
            icon={
              <>
                <path d="M3 7h11v9H3z M14 10h4l3 3v3h-7" />
                <circle cx="7" cy="17.5" r="1.8" />
                <circle cx="17" cy="17.5" r="1.8" />
              </>
            }
          />
          <Pledge title={t('home.promises.save.title')} body={t('home.promises.save.body')} icon={<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z" />} />
          <Pledge
            title={t('home.promises.help.title')}
            body={t('home.promises.help.body')}
            icon={
              <>
                <path d="M4 12a8 8 0 1116 0v4a2 2 0 01-2 2h-1v-6h3 M4 12v4a2 2 0 002 2h1v-6H4" />
              </>
            }
          />
        </ul>
      </section>

      <section className={styles.signup}>
        <div className={styles.signupInner}>
          <div className={styles.signupCopy}>
            <h2 className={styles.heading}>{t('home.signup.title')}</h2>
            <p className={styles.signupBody}>{t('home.signup.body')}</p>
          </div>
          <Link href="/register/" className={styles.signupAction}>
            {t('home.signup.action')} <Arrow />
          </Link>
        </div>
      </section>
    </Layout>
  )
}
