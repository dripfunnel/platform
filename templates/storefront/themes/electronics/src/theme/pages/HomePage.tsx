import type { ReactNode } from 'react'
import { Image, Link, Price, ThemeImage, useCollections, useProducts, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { GridPlaceholder, ProductGrid } from '../components/ProductCard'
import { home as styles } from '../components/styles/home'

const Arrow = () => (
  <svg className={styles.arrow} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 12h14 M13 6l6 6-6 6" />
  </svg>
)

const Heading = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
  <div className={styles.headCopy}>
    <p className={styles.eyebrow}>
      <span className={styles.dot} aria-hidden="true" />
      {eyebrow}
    </p>
    <h2 className={styles.heading}>{title}</h2>
  </div>
)

const PromiseItem = ({ icon, title, body }: { icon: ReactNode; title: string; body: string }) => (
  <li className={styles.promise}>
    <span className={styles.promiseIcon}>
      <svg className={styles.promiseSvg} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {icon}
      </svg>
    </span>
    <div>
      <p className={styles.promiseTitle}>{title}</p>
      <p className={styles.promiseBody}>{body}</p>
    </div>
  </li>
)

export const HomePage = () => {
  const { store, locale, t } = useStorefront()
  const collections = useCollections({ first: 5 }).collections.slice(0, 5)
  const newest = useProducts({ sort: 'newest', first: 8 })
  const picks = useProducts({ sort: 'best-selling', first: 4 })
  const top = useProducts({ sort: 'price-high', first: 1 })
  const spotlit = top.products[0] ?? null

  return (
    <Layout>
      <section className={styles.hero} aria-labelledby="home-hero">
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <p className={styles.heroEyebrow}>
              <span className={styles.heroDot} aria-hidden="true" />
              {t('home.hero.eyebrow')}
            </p>
            <h1 id="home-hero" className={styles.heroTitle}>
              {t('home.hero.title')} <span className={styles.heroAccent}>{t('home.hero.accent')}</span>
            </h1>
            <p className={styles.heroLead}>{store.description ?? t('home.hero.lead')}</p>
            <div className={styles.actions}>
              <Link href="/collections/all/?sort=newest" className={styles.volt}>
                {t('home.hero.shop')} <Arrow />
              </Link>
              <Link href="/collections/all/" className={styles.ghostDark}>
                {t('home.hero.all')}
              </Link>
            </div>
            <ul className={styles.facts} aria-label={t('home.hero.facts')}>
              {collections.length ? (
                <li className={styles.fact}>
                  <p className={styles.factValue}>{t('home.hero.categories', { count: collections.length })}</p>
                  <p className={styles.factLabel}>{t('home.categories.eyebrow')}</p>
                </li>
              ) : null}
              <li className={styles.fact}>
                <p className={styles.factValue}>{t('home.promises.secure.title')}</p>
                <p className={styles.factLabel}>{t('home.hero.secure')}</p>
              </li>
              <li className={styles.fact}>
                <p className={styles.factValue}>{t('home.promises.track.title')}</p>
                <p className={styles.factLabel}>{t('home.hero.track')}</p>
              </li>
            </ul>
          </div>
          <div className={styles.heroStage}>
            <ThemeImage src="hero-keys.webp" alt={t('home.hero.alt')} ratio={0.8} sizes="(min-width: 900px) 520px, 100vw" className={styles.heroImage} />
            {spotlit?.price ? (
              <Link href={spotlit.href} className={styles.tag}>
                <span className={styles.tagCopy}>
                  <span className={styles.tagLabel}>{t('home.hero.spotlight')}</span>
                  <span className={styles.tagName}>{spotlit.name}</span>
                </span>
                <Price money={spotlit.price} compareAt={null} includesTax={store.pricesIncludeTax} locale={locale} t={t} className={styles.tagPrice} />
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {collections.length ? (
        <section className={styles.section}>
          <div className={styles.head}>
            <Heading eyebrow={t('home.categories.eyebrow')} title={t('home.categories.title')} />
          </div>
          <ul className={styles.categories}>
            {collections.map((c) => (
              <li key={c.id}>
                <Link href={c.href} className={styles.category}>
                  <span className={styles.categoryPicture}>{c.image ? <Image image={c.image} alt="" ratio={1} sizes="(min-width: 1100px) 200px, 50vw" className={styles.categoryImage} /> : null}</span>
                  <span className={styles.categoryFoot}>
                    <span className={styles.categoryName}>{c.name}</span>
                    <span className={styles.categoryArrow} aria-hidden="true">
                      <Arrow />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            <li>
              <Link href="/collections/all/" className={styles.allTile}>
                <span className={styles.allName}>{t('home.categories.all')}</span>
                <span className={styles.allArrow} aria-hidden="true">
                  <Arrow />
                </span>
              </Link>
            </li>
          </ul>
        </section>
      ) : null}

      {newest.status === 'loading' || newest.products.length ? (
      <section className={styles.section}>
        <div className={styles.head}>
          <Heading eyebrow={t('home.newest.eyebrow')} title={t('home.newest.title')} />
          <Link href="/collections/all/?sort=newest" className={styles.viewAll}>
            {t('home.newest.all')} <Arrow />
          </Link>
        </div>
        {newest.status === 'loading' ? <GridPlaceholder label={t('home.newest.title')} count={4} /> : <ProductGrid products={newest.products} wide />}
      </section>
      ) : null}

      {spotlit ? (
        <section className={styles.spotlightWrap} aria-labelledby="home-spotlight">
          <div className={styles.spotlight}>
            <div className={styles.spotlightStage}>
              <div className={styles.spotlightFrame}>{spotlit.photo ? <Image image={spotlit.photo} alt={spotlit.photo.alt ?? spotlit.name} ratio={1} sizes="(min-width: 900px) 440px, 90vw" className={styles.spotlightImage} /> : null}</div>
            </div>
            <div className={styles.spotlightCopy}>
              <p className={styles.spotlightEyebrow}>{t('home.spotlight.eyebrow')}</p>
              <h2 id="home-spotlight" className={styles.spotlightName}>
                {spotlit.name}
              </h2>
              <p className={styles.spotlightBody}>{t('home.spotlight.body')}</p>
              {spotlit.price ? <Price money={spotlit.price} compareAt={spotlit.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} className={styles.spotlightPrice} /> : null}
              <div className={styles.actions}>
                <Link href={spotlit.href} className={styles.volt}>
                  {t('home.spotlight.view')} <Arrow />
                </Link>
                <Link href="/collections/all/?sort=price-high" className={styles.ghostDark}>
                  {t('home.spotlight.more')}
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className={styles.promos}>
        <section className={styles.promoLight} aria-labelledby="home-promo-sound">
          <div className={styles.promoCopy}>
            <p className={styles.promoEyebrow}>{t('home.promos.sound.eyebrow')}</p>
            <h2 id="home-promo-sound" className={styles.promoTitle}>
              {t('home.promos.sound.title')}
            </h2>
            <Link href="/collections/all/?sort=newest" className={styles.button}>
              {t('home.promos.sound.action')} <Arrow />
            </Link>
          </div>
          <div className={styles.promoSoundPicture}>
            <ThemeImage src="promo-sound.webp" alt={t('home.promos.sound.alt')} ratio={1} sizes="(min-width: 900px) 300px, 100vw" className={styles.promoImage} />
          </div>
        </section>
        <section className={styles.promoDark} aria-labelledby="home-promo-light">
          <div className={styles.promoLightPicture}>
            <ThemeImage src="promo-light.webp" alt={t('home.promos.light.alt')} ratio={1.2} sizes="(min-width: 900px) 600px, 100vw" className={styles.promoImage} />
          </div>
          <div className={styles.promoShade} aria-hidden="true" />
          <div className={styles.promoCopy}>
            <p className={styles.promoEyebrowDark}>{t('home.promos.light.eyebrow')}</p>
            <h2 id="home-promo-light" className={styles.promoTitle}>
              {t('home.promos.light.title')}
            </h2>
            <Link href="/collections/all/" className={styles.volt}>
              {t('home.promos.light.action')} <Arrow />
            </Link>
          </div>
        </section>
      </div>

      <section className={styles.promisesBand} aria-label={t('home.promises.label')}>
        <ul className={styles.promises}>
          <PromiseItem
            title={t('home.promises.secure.title')}
            body={t('home.promises.secure.body')}
            icon={
              <>
                <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
                <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
              </>
            }
          />
          <PromiseItem
            title={t('home.promises.track.title')}
            body={t('home.promises.track.body')}
            icon={
              <>
                <path d="M3 7h11v9H3z" />
                <path d="M14 10h4l3 3v3h-7" />
                <circle cx="7" cy="17.5" r="1.8" />
                <circle cx="17" cy="17.5" r="1.8" />
              </>
            }
          />
          <PromiseItem title={t('home.promises.save.title')} body={t('home.promises.save.body')} icon={<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z" />} />
          <PromiseItem
            title={t('home.promises.help.title')}
            body={t('home.promises.help.body')}
            icon={
              <>
                <path d="M4 12a8 8 0 0116 0v4a2 2 0 01-2 2h-1v-6h3" />
                <path d="M4 12v4a2 2 0 002 2h1v-6H4" />
              </>
            }
          />
        </ul>
      </section>

      {picks.status === 'loading' || picks.products.length ? (
      <section className={styles.section}>
        <div className={styles.head}>
          <Heading eyebrow={t('home.picks.eyebrow')} title={t('home.picks.title')} />
          <Link href="/collections/all/" className={styles.viewAll}>
            {t('home.picks.all')} <Arrow />
          </Link>
        </div>
        {picks.status === 'loading' ? <GridPlaceholder label={t('home.picks.title')} count={4} /> : <ProductGrid products={picks.products} wide />}
      </section>
      ) : null}

      <div className={styles.signupWrap}>
        <section className={styles.signup} aria-labelledby="home-signup">
          <div className={styles.signupCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.dot} aria-hidden="true" />
              {t('home.signup.eyebrow')}
            </p>
            <h2 id="home-signup" className={styles.signupTitle}>
              {t('home.signup.title')}
            </h2>
            <p className={styles.signupBody}>{t('home.signup.body')}</p>
          </div>
          <Link href="/account/" className={styles.primary}>
            {t('home.signup.action')} <Arrow />
          </Link>
        </section>
      </div>
    </Layout>
  )
}
