import { Image, Link, ThemeImage, useCollections, useProducts, useStorefront, type ProductCard as Card } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { GridPlaceholder, ProductCard } from '../components/ProductCard'
import { home as styles } from '../components/styles/home'

const Arrow = () => (
  <svg className={styles.arrow} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 12h14 M13 6l6 6-6 6" />
  </svg>
)

const Heading = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
  <div className={styles.headCopy}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h2 className={styles.heading}>{title}</h2>
  </div>
)

const Grid = ({ products, wide }: { products: readonly Card[]; wide: boolean }) => (
  <ul className={wide ? styles.gridFour : styles.gridThree}>
    {products.map((p) => (
      <li key={p.id} className={styles.cell}>
        <ProductCard product={p} />
      </li>
    ))}
  </ul>
)

export const HomePage = () => {
  const { store, t } = useStorefront()
  const { collections } = useCollections({ first: 5 })
  const newest = useProducts({ sort: 'newest', first: 6 })
  const picks = useProducts({ sort: 'best-selling', first: 4 })

  return (
    <Layout>
      <section className={styles.hero}>
        <div className={styles.heroPicture}>
          <ThemeImage src="hero-light.webp" alt={t('home.hero.alt')} ratio={1.5} sizes="100vw" className={styles.cover} />
        </div>
        <div className={styles.heroCard}>
          <p className={styles.eyebrow}>{t('home.hero.eyebrow')}</p>
          <h1 className={styles.heroTitle}>
            {t('home.hero.title')} <em className={styles.accent}>{t('home.hero.accent')}</em>
          </h1>
          <p className={styles.lead}>{store.description ?? t('home.hero.lead')}</p>
          <div className={styles.actions}>
            <Link href="/collections/all/" className={styles.button}>
              {t('home.hero.shop')} <Arrow />
            </Link>
            <Link href="/collections/all/?sort=newest" className={styles.quiet}>
              {t('home.hero.newest')}
            </Link>
          </div>
        </div>
      </section>

      {/* #713: nothing above the story while loading, so an empty answer moves nothing. */}
      {collections.length ? (
        <section className={styles.section}>
          <div className={styles.head}>
            <Heading eyebrow={t('home.rooms.eyebrow')} title={t('home.rooms.title')} />
            <Link href="/collections/all/" className={styles.more}>
              {t('home.rooms.all')} <Arrow />
            </Link>
          </div>
          <ul className={styles.rooms}>
            {collections.map((c) => (
              <li key={c.id} className={styles.room}>
                <Link href={c.href} className={styles.roomLink}>
                  {c.image ? <Image image={c.image} alt="" ratio={1.5} sizes="(min-width: 900px) 50vw, 100vw" className={styles.roomImage} /> : null}
                  <span className={styles.roomCopy}>
                    <span className={styles.roomName}>{c.name}</span>
                    <span className={styles.roomMore}>
                      {t('home.rooms.explore')} <Arrow />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {newest.products.length ? (
        <section className={styles.section}>
          <div className={styles.head}>
            <Heading eyebrow={t('home.newest.eyebrow')} title={t('home.newest.title')} />
            <Link href="/collections/all/?sort=newest" className={styles.more}>
              {t('home.newest.all')} <Arrow />
            </Link>
          </div>
          <Grid products={newest.products} wide={false} />
        </section>
      ) : null}

      <section className={styles.story}>
        <div className={styles.collage}>
          <div className={styles.collageMain}>
            <ThemeImage src="story-bed.webp" alt={t('home.story.bedAlt')} ratio={0.67} sizes="(min-width: 900px) 34vw, 64vw" className={styles.cover} />
          </div>
          <div className={styles.collageTop}>
            <ThemeImage src="story-vase.webp" alt={t('home.story.vaseAlt')} ratio={0.75} sizes="(min-width: 900px) 18vw, 34vw" className={styles.cover} />
          </div>
          <div className={styles.collageSide}>
            <ThemeImage src="story-lamp.webp" alt={t('home.story.lampAlt')} ratio={1.5} sizes="(min-width: 900px) 26vw, 46vw" className={styles.cover} />
          </div>
        </div>
        <div className={styles.storyCopy}>
          <p className={styles.eyebrow}>{t('home.story.eyebrow')}</p>
          <h2 className={styles.storyTitle}>
            {t('home.story.title')} <em className={styles.accent}>{t('home.story.accent')}</em>
          </h2>
          <p className={styles.body}>{t('home.story.body')}</p>
          <Link href="/about/" className={styles.ghost}>
            {t('home.story.more')} <Arrow />
          </Link>
        </div>
      </section>

      <section className={styles.quote}>
        <div className={styles.quoteInner}>
          <p className={styles.quoteBy}>{t('home.quote.eyebrow')}</p>
          <p className={styles.quoteLine}>{t('home.quote.text')}</p>
        </div>
      </section>

      {picks.status === 'loading' || picks.products.length ? (
        <section className={styles.section}>
          <div className={styles.head}>
            <Heading eyebrow={t('home.picks.eyebrow')} title={t('home.picks.title')} />
            <Link href="/collections/all/" className={styles.more}>
              {t('home.picks.all')} <Arrow />
            </Link>
          </div>
          {picks.status === 'loading' ? <GridPlaceholder label={t('shop.listing.loading')} count={4} list={styles.gridFour} cell={styles.cell} /> : <Grid products={picks.products} wide />}
        </section>
      ) : null}

      <section className={styles.section} aria-label={t('home.promises.label')}>
        <ul className={styles.promises}>
          <li className={styles.promise}>
            <p className={styles.promiseTitle}>{t('home.promises.secure.title')}</p>
            <p className={styles.promiseBody}>{t('home.promises.secure.body')}</p>
          </li>
          <li className={styles.promise}>
            <p className={styles.promiseTitle}>{t('home.promises.track.title')}</p>
            <p className={styles.promiseBody}>{t('home.promises.track.body')}</p>
          </li>
          <li className={styles.promise}>
            <p className={styles.promiseTitle}>{t('home.promises.save.title')}</p>
            <p className={styles.promiseBody}>{t('home.promises.save.body')}</p>
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.banner}>
          <div className={styles.bannerCopy}>
            <p className={styles.eyebrowLight}>{t('home.banner.eyebrow')}</p>
            <h2 className={styles.bannerTitle}>{t('home.banner.title')}</h2>
            <p className={styles.bannerBody}>{t('home.banner.body')}</p>
            <Link href="/collections/all/" className={styles.buttonLight}>
              {t('home.banner.action')} <Arrow />
            </Link>
          </div>
          <div className={styles.bannerPicture}>
            <ThemeImage src="banner-room.webp" alt={t('home.banner.alt')} ratio={1.5} sizes="(min-width: 900px) 60vw, 100vw" className={styles.cover} />
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.signup}>
          <h2 className={styles.signupTitle}>{t('home.signup.title')}</h2>
          <p className={styles.signupBody}>{t('home.signup.body')}</p>
          <Link href="/register/" className={styles.buttonLinen}>
            {t('home.signup.action')}
          </Link>
        </div>
      </section>
    </Layout>
  )
}
