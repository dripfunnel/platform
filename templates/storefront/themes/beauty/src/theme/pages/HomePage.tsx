import type { ReactNode } from 'react'
import { Image, Link, ThemeImage, useCollections, useProducts, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { GridPlaceholder, ProductGrid } from '../components/ProductCard'
import { home as styles } from '../components/styles/home'

const Arrow = () => (
  <svg className={styles.arrow} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 12h14 M13 6l6 6-6 6" />
  </svg>
)

const Head = ({ eyebrow, title, more }: { eyebrow: string; title: string; more?: ReactNode }) => (
  <div className={styles.head}>
    <div className={styles.headCopy}>
      <p className={styles.eyebrowTint}>{eyebrow}</p>
      <h2 className={styles.heading}>{title}</h2>
    </div>
    {more}
  </div>
)

const PromiseItem = ({ icon, title, body }: { icon: ReactNode; title: string; body: string }) => (
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

const Step = ({ number, title, body }: { number: number; title: string; body: string }) => (
  <li className={styles.step}>
    <span className={styles.stepNumber} aria-hidden="true">
      {number}
    </span>
    <h3 className={styles.stepTitle}>{title}</h3>
    <p className={styles.stepBody}>{body}</p>
  </li>
)

export const HomePage = () => {
  const { t, store } = useStorefront()
  const { collections, status } = useCollections({ first: 8 })
  const newest = useProducts({ sort: 'newest', first: 8 })
  const picks = useProducts({ sort: 'best-selling', first: 4 })
  const tiles = collections.filter((c) => c.image).slice(0, 4)

  return (
    <Layout>
      <section className={styles.hero}>
        <div className={styles.heroPanel}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{t('home.hero.eyebrow')}</p>
            <h1 className={styles.heroTitle}>
              {t('home.hero.title')} <span className={styles.accent}>{t('home.hero.accent')}</span>
            </h1>
            <p className={styles.heroLead}>{store.description ?? t('home.hero.lead')}</p>
            <div className={styles.heroActions}>
              <Link href="/collections/all/?sort=newest" className={styles.button}>
                {t('home.hero.shop')} <Arrow />
              </Link>
              <Link href="/collections/all/" className={styles.buttonLight}>
                {t('home.hero.favourites')}
              </Link>
            </div>
          </div>
          <div className={styles.heroFrame}>
            <span className={styles.heroPicture}>
              <ThemeImage src="hero-face.webp" alt={t('home.hero.alt')} ratio={0.667} sizes="(min-width: 900px) 600px, 100vw" className={styles.heroImage} />
            </span>
            <span className={styles.heroDetail}>
              <ThemeImage src="hero-petals.webp" alt={t('home.hero.detailAlt')} ratio={1.5} sizes="224px" className={styles.heroDetailImage} />
            </span>
          </div>
        </div>
      </section>

      {status === 'loading' || collections.length ? (
        <nav className={styles.chips} aria-label={t('home.chips.label')}>
          <ul className={styles.chipsRow} aria-busy={status === 'loading' ? 'true' : undefined}>
            <li className={styles.chipsLabel} aria-hidden="true">
              {t('home.chips.label')}
            </li>
            {status === 'loading'
              ? [0, 1, 2, 3].map((i) => (
                  <li key={i}>
                    <span className={styles.chipSkeleton} />
                  </li>
                ))
              : null}
            {collections.map((c) => (
              <li key={c.id}>
                <Link href={c.href} className={styles.chip}>
                  {c.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/collections/all/" className={styles.chipAll}>
                {t('home.chips.all')} <Arrow />
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}

      {newest.status === 'loading' || newest.products.length ? (
        <section className={styles.section}>
          <Head
            eyebrow={t('home.newest.eyebrow')}
            title={t('home.newest.title')}
            more={
              <Link href="/collections/all/?sort=newest" className={styles.more}>
                {t('home.newest.all')} <Arrow />
              </Link>
            }
          />
          {newest.status === 'loading' ? <GridPlaceholder label={t('shop.listing.loading')} count={4} wide /> : <ProductGrid products={newest.products} wide />}
        </section>
      ) : null}

      <section className={styles.routine}>
        <div className={styles.routinePanel}>
          <span className={styles.routinePicture}>
            <ThemeImage src="routine-cream.webp" alt={t('home.routine.alt')} ratio={0.667} sizes="(min-width: 900px) 420px, 100vw" className={styles.routineImage} />
          </span>
          <div className={styles.routineCopy}>
            <p className={styles.routineEyebrow}>{t('home.routine.eyebrow')}</p>
            <h2 className={styles.routineTitle}>{t('home.routine.title')}</h2>
            <p className={styles.routineLead}>{t('home.routine.lead')}</p>
            <ol className={styles.steps}>
              <Step number={1} title={t('home.routine.stepOne.title')} body={t('home.routine.stepOne.body')} />
              <Step number={2} title={t('home.routine.stepTwo.title')} body={t('home.routine.stepTwo.body')} />
              <Step number={3} title={t('home.routine.stepThree.title')} body={t('home.routine.stepThree.body')} />
            </ol>
            <Link href="/collections/all/" className={styles.routineAction}>
              {t('home.routine.action')} <Arrow />
            </Link>
          </div>
        </div>
      </section>

      {status === 'loading' || tiles.length ? (
        <section className={styles.section}>
          <Head
            eyebrow={t('home.categories.eyebrow')}
            title={t('home.categories.title')}
            more={
              <Link href="/collections/all/" className={styles.more}>
                {t('home.categories.all')} <Arrow />
              </Link>
            }
          />
          <ul className={styles.tiles} aria-busy={status === 'loading' ? 'true' : undefined}>
            {status === 'loading'
              ? [0, 1, 2, 3].map((i) => (
                  <li key={i}>
                    <span className={styles.tilePicture} />
                  </li>
                ))
              : tiles.map((c) => (
                  <li key={c.id}>
                    <Link href={c.href} className={styles.tile}>
                      <span className={styles.tilePicture}>{c.image ? <Image image={c.image} alt="" ratio={0.8} sizes="(min-width: 900px) 25vw, 50vw" className={styles.tileImage} /> : null}</span>
                      <span className={styles.tileFoot}>
                        <span className={styles.tileName}>{c.name}</span>
                        <span className={styles.tileArrow}>
                          <Arrow />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.story}>
        <div className={styles.storyPictures}>
          <span className={styles.storyPicture}>
            <ThemeImage src="story-jars.webp" alt={t('home.story.alt')} ratio={1.333} sizes="(min-width: 900px) 640px, 100vw" className={styles.storyImage} />
          </span>
        </div>
        <div className={styles.storyCopy}>
          <p className={styles.eyebrowTint}>{t('home.story.eyebrow')}</p>
          <h2 className={styles.heading}>{t('home.story.title')}</h2>
          <p className={styles.body}>{t('home.story.body')}</p>
          <Link href="/about/" className={styles.buttonLight}>
            {t('home.story.more')} <Arrow />
          </Link>
        </div>
      </section>

      {picks.status === 'loading' || picks.products.length ? (
        <section className={styles.section}>
          <Head
            eyebrow={t('home.picks.eyebrow')}
            title={t('home.picks.title')}
            more={
              <Link href="/collections/all/" className={styles.more}>
                {t('home.picks.all')} <Arrow />
              </Link>
            }
          />
          {picks.status === 'loading' ? <GridPlaceholder label={t('shop.listing.loading')} count={4} wide /> : <ProductGrid products={picks.products} wide />}
        </section>
      ) : null}

      <section className={styles.promises} aria-label={t('home.promises.label')}>
        <ul className={styles.promiseList}>
          <PromiseItem
            icon={
              <>
                <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
                <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
              </>
            }
            title={t('home.promises.secure.title')}
            body={t('home.promises.secure.body')}
          />
          <PromiseItem
            icon={
              <>
                <path d="M3.5 7.5h10v9h-10z" />
                <path d="M13.5 10.5h4l3 3v3h-7" />
                <circle cx="7.5" cy="17.5" r="1.8" />
                <circle cx="17" cy="17.5" r="1.8" />
              </>
            }
            title={t('home.promises.track.title')}
            body={t('home.promises.track.body')}
          />
          <PromiseItem icon={<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z" />} title={t('home.promises.save.title')} body={t('home.promises.save.body')} />
          <PromiseItem
            icon={
              <>
                <path d="M4.5 12a7.5 7.5 0 1115 0v4.5a2 2 0 01-2 2h-1.5v-6h3.5" />
                <path d="M4.5 12.5h3.5v6H6.5a2 2 0 01-2-2z" />
              </>
            }
            title={t('home.promises.help.title')}
            body={t('home.promises.help.body')}
          />
        </ul>
      </section>

      <section className={styles.signup}>
        <div className={styles.signupPanel}>
          <div className={styles.signupCopy}>
            <p className={styles.eyebrow}>{t('home.signup.eyebrow')}</p>
            <h2 className={styles.heading}>{t('home.signup.title')}</h2>
            <p className={styles.body}>{t('home.signup.body')}</p>
            <Link href="/register/" className={styles.button}>
              {t('home.signup.action')} <Arrow />
            </Link>
          </div>
          <span className={styles.signupPicture}>
            <ThemeImage src="signup-smile.webp" alt={t('home.signup.alt')} ratio={0.667} sizes="(min-width: 900px) 480px, 100vw" className={styles.signupImage} />
          </span>
        </div>
      </section>
    </Layout>
  )
}
