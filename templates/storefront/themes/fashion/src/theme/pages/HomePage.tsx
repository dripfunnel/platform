import type { ReactNode } from 'react'
import { Image, Link, ThemeImage, useCollections, useProducts, useStorefront, type ProductCard as Card } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { GridPlaceholder, ProductCard } from '../components/ProductCard'
import { HeroCarousel } from '../components/interactive/HeroCarousel'
import { home as styles } from '../components/styles/home'

const Heading = ({ eyebrow, title, accent }: { eyebrow: string; title: string; accent: string }) => (
  <div className={styles.headCopy}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h2 className={styles.heading}>
      {title} <em className={styles.accent}>{accent}</em>
    </h2>
  </div>
)

const Arrow = () => (
  <svg className={styles.arrow} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 12h14 M13 6l6 6-6 6" />
  </svg>
)

const Rail = ({ products, label }: { products: readonly Card[]; label: string }) => (
  <div className={styles.railWrap}>
    <ul className={styles.rail} aria-label={label}>
      {products.map((p) => (
        <li key={p.id} className={styles.railItem}>
          <ProductCard product={p} />
        </li>
      ))}
    </ul>
  </div>
)


const PromiseItem = ({ icon, title, body }: { icon: ReactNode; title: string; body: string }) => (
  <li className={styles.promise}>
    {icon}
    <div>
      <p className={styles.promiseTitle}>{title}</p>
      <p className={styles.promiseBody}>{body}</p>
    </div>
  </li>
)

const Icon = ({ children }: { children: ReactNode }) => (
  <svg className={styles.promiseIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {children}
  </svg>
)

export const HomePage = () => {
  const { t } = useStorefront()
  const { collections, status } = useCollections({ first: 8 })
  const loading = status === 'loading'
  const newest = useProducts({ sort: 'newest', first: 8 })
  const picks = useProducts({ sort: 'best-selling', first: 8 })
  const spotlight = useProducts({ sort: 'price-high', first: 4 })
  const featured = collections.find((c) => c.image) ?? null

  return (
    <Layout>
      <HeroCarousel />

      {collections.length ? (
        <div className={styles.marquee} aria-hidden="true">
          <div className={styles.marqueeTrack}>
            {collections.map((c) => (
              <span key={c.id} className={styles.marqueeItem}>
                {c.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {loading || collections.length ? (
        <nav aria-label={t('home.categories.title')}>
          <ul className={styles.bubbles} aria-busy={loading ? 'true' : undefined}>
            {loading
              ? [0, 1, 2, 3, 4].map((i) => (
                  <li key={i}>
                    <span className={styles.bubblePicture} />
                  </li>
                ))
              : null}
            {collections.map((c) => (
              <li key={c.id}>
                <Link href={c.href} className={styles.bubble}>
                  <span className={styles.bubblePicture}>{c.image ? <Image image={c.image} alt="" ratio={1} sizes="112px" className={styles.bubbleImage} /> : null}</span>
                  <span className={styles.bubbleName}>{c.name}</span>
                </Link>
              </li>
            ))}
            <li>
              <Link href="/collections/all/" className={styles.all}>
                <span className={styles.allCircle} aria-hidden="true">
                  <svg className={styles.plus} viewBox="0 0 24 24" focusable="false">
                    <path d="M12 5v14 M5 12h14" />
                  </svg>
                </span>
                <span className={styles.bubbleName}>{t('home.categories.all')}</span>
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}

      {newest.status === 'loading' || newest.products.length ? (
        <section>
          <div className={styles.head}>
            <Heading eyebrow={t('home.newest.eyebrow')} title={t('home.newest.title')} accent={t('home.newest.accent')} />
            <Link href="/collections/all/?sort=newest" className={styles.link}>
              {t('home.newest.all')} <Arrow />
            </Link>
          </div>
          {newest.status === 'loading' ? <GridPlaceholder label={t('shop.listing.loading')} count={4} /> : <Rail products={newest.products} label={t('home.newest.label')} />}
        </section>
      ) : null}

      <section className={styles.story}>
        <div className={styles.storyPicture}>
          <ThemeImage src="story-rack.webp" alt={t('home.story.alt')} ratio={1.5} sizes="(min-width: 900px) 50vw, 100vw" className={styles.image} />
        </div>
        <div className={styles.storyCopy}>
          <Heading eyebrow={t('home.story.eyebrow')} title={t('home.story.title')} accent={t('home.story.accent')} />
          <p className={styles.storyBody}>{t('home.story.body')}</p>
          {collections.length ? (
            <div className={styles.stat}>
              <p className={styles.statNumber}>{collections.length}</p>
              <p className={styles.statLabel}>{t('home.story.collections', { count: collections.length })}</p>
            </div>
          ) : null}
          <Link href="/about/" className={styles.link}>
            {t('home.story.more')} <Arrow />
          </Link>
        </div>
      </section>

      <div className={styles.promisesBand}>
      <ul className={styles.promises} aria-label={t('home.promises.label')}>
        <PromiseItem icon={<Icon><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z M9 12l2 2 4-4" /></Icon>} title={t('home.promises.secure.title')} body={t('home.promises.secure.body')} />
        <PromiseItem icon={<Icon><path d="M3 7h11v9H3z M14 10h4l3 3v3h-7z" /><circle cx="7" cy="17.5" r="1.5" /><circle cx="17" cy="17.5" r="1.5" /></Icon>} title={t('home.promises.track.title')} body={t('home.promises.track.body')} />
        <PromiseItem icon={<Icon><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" /></Icon>} title={t('home.promises.save.title')} body={t('home.promises.save.body')} />
        <PromiseItem icon={<Icon><path d="M4 5h16v11H8l-4 4z" /></Icon>} title={t('home.promises.help.title')} body={t('home.promises.help.body')} />
      </ul>
      </div>

      {picks.status === 'loading' || picks.products.length ? (
        <section>
          <div className={styles.head}>
            <Heading eyebrow={t('home.picks.eyebrow')} title={t('home.picks.title')} accent={t('home.picks.accent')} />
            <Link href="/collections/all/" className={styles.link}>
              {t('home.picks.all')} <Arrow />
            </Link>
          </div>
          {picks.status === 'loading' ? <GridPlaceholder label={t('shop.listing.loading')} count={4} /> : <Rail products={picks.products} label={t('home.picks.label')} />}
        </section>
      ) : null}

      {featured && spotlight.products.length ? (
        <section>
          <div className={styles.head}>
            <Heading eyebrow={t('home.featured.eyebrow')} title={t('home.featured.title')} accent={t('home.featured.accent')} />
          </div>
          <div className={styles.feature}>
            <Link href={featured.href} className={styles.featureMain}>
              {featured.image ? <Image image={featured.image} alt="" ratio={0.75} sizes="(min-width: 900px) 50vw, 100vw" className={styles.image} /> : null}
              <span className={styles.featureCopy}>
                <span className={styles.featureName}>{featured.name}</span>
                <span className={styles.button}>{t('home.featured.shop', { name: featured.name })}</span>
              </span>
            </Link>
            <ul className={styles.featureGrid}>
              {spotlight.products.map((p) => (
                <li key={p.id}>
                  <ProductCard product={p} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className={styles.head}>
        <div className={styles.bannerPicture}>
          <ThemeImage src="banner-sun.webp" alt={t('home.banner.alt')} ratio={1.5} sizes="100vw" className={styles.bannerImage} />
          <div className={styles.bannerCopy}>
            <p className={styles.eyebrowLight}>{t('home.banner.eyebrow')}</p>
            <h2 className={styles.heroTitle}>
              {t('home.banner.title')} <em className={styles.em}>{t('home.banner.accent')}</em>
            </h2>
            <Link href="/collections/all/" className={styles.buttonLight}>
              {t('home.banner.action')} <Arrow />
            </Link>
          </div>
        </div>
      </section>

      {collections.length > 1 ? (
        <section>
          <div className={styles.head}>
            <Heading eyebrow={t('home.explore.eyebrow')} title={t('home.explore.title')} accent={t('home.explore.accent')} />
          </div>
          <ul className={styles.grid}>
            {collections.slice(0, 5).map((c) => (
              <li key={c.id} className={styles.tileCell}>
                <Link href={c.href} className={styles.tile}>
                  {c.image ? <Image image={c.image} alt="" ratio={0.75} sizes="(min-width: 900px) 25vw, 50vw" className={styles.image} /> : null}
                  <span className={styles.tileShade} />
                  <span className={styles.tileName}>{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.signup}>
        <h2 className={styles.heading}>{t('home.signup.title')}</h2>
        <p className={styles.signupBody}>{t('home.signup.body')}</p>
        <Link href="/register/" className={styles.button}>
          {t('home.signup.action')}
        </Link>
      </section>
    </Layout>
  )
}
