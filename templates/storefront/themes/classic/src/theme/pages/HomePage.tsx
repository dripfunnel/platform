import type { ReactNode } from 'react'
import { Image, Link, useCollections, useListing, useMenu, useProducts, useStorefront, type CollectionCard, type ProductCard as Card } from '@dripfunnel/storefront-core/theme'
import { HeroCarousel } from '../components/interactive/HeroCarousel'
import { Layout } from '../components/Layout'
import { ProductCard } from '../components/ProductCard'
import { SectionHeading } from '../components/SectionHeading'
import { Spotlight } from '../components/Spotlight'
import { cx } from '../components/cx'
import { slugOf } from '../components/slugOf'
import art from '../styles/art.module.css'
import shop from '../styles/shop.module.css'
import styles from '../styles/home.module.css'

/** The painted placeholder behind a collection's picture, in turn by its place in the store's list. */
const paints = [art.stone, art.sand, art.slate, art.sage]
const paintOf = (index: number) => paints[index % paints.length]

const Pledge = ({ title, body, children }: { title: string; body: string; children: ReactNode }) => (
  <li className={styles.promise}>
    <span className={styles.promiseIcon} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {children}
      </svg>
    </span>
    <h3 className={styles.promiseTitle}>{title}</h3>
    <p className={styles.promiseBody}>{body}</p>
  </li>
)

const ArrowIcon = () => (
  <svg className={styles.arrowIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

/** The rail's one row of grey cards, in the shape its products arrive in: loading, or with a note when there are none. */
const RailPlaceholder = ({ label, note }: { label: string; note: string | null }) => (
  <div className={styles.railHold}>
    <ul className={styles.railList} aria-hidden={note ? true : undefined} aria-busy={note ? undefined : true} aria-label={note ? undefined : label}>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className={styles.railItem}>
          <div className={shop.skeletonPicture} />
          <div className={shop.skeletonLine} />
        </li>
      ))}
    </ul>
    {note ? <p className={styles.railEmpty}>{note}</p> : null}
  </div>
)

/**
 * A titled row of product cards that scrolls sideways on narrow screens. With `empty`, a store without products
 * keeps the row's place and says so, so nothing below it moves (the publish gate's layout-shift budget).
 */
const ProductRail = ({ title, action, products, empty }: { title: string; action: ReactNode; products: { status: string; items: Card[] }; empty?: string }) => {
  const { t } = useStorefront()
  const none = products.status !== 'loading' && !products.items.length
  if (none && !empty) return null
  return (
    <section className={styles.rail}>
      <div className={styles.railHead}>
        <h2 className={styles.railTitle}>{title}</h2>
        {none ? null : action}
      </div>
      {products.status === 'loading' || none ? (
        <RailPlaceholder label={t('shop.listing.loading')} note={none ? (empty ?? null) : null} />
      ) : (
        <ul className={styles.railList}>
          {products.items.map((product) => (
            <li key={product.id} className={styles.railItem}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A collection's products under a centred heading, with a "view all" pill. */
const Deals = ({ collection }: { collection: CollectionCard | undefined }) => {
  const { t } = useStorefront()
  const { items } = useListing({ collection: collection ? slugOf(collection) : null }, collection !== undefined)
  if (!collection || !items.length) return null
  return (
    <section className={styles.section}>
      <SectionHeading eyebrow={t('home.deals.eyebrow')} title={collection.name} />
      <ul className={styles.grid}>
        {items.slice(0, 8).map((product) => (
          <li key={product.id}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
      <div className={styles.more}>
        <Link href={collection.href} className={styles.pill}>
          {t('home.viewAll')}
          <ArrowIcon />
        </Link>
      </div>
    </section>
  )
}

export const HomePage = () => {
  const { t } = useStorefront()
  const menu = useMenu()
  const { collections: categories, status } = useCollections({ first: 20 })
  const newest = useProducts({ sort: 'newest', first: 8 })
  const primary = categories[0] ? slugOf(categories[0]) : null
  const featured = useListing({ collection: primary }, primary !== null)
  const storyImage = categories[0]?.image ?? null
  const signupImage = categories[1]?.image ?? null
  const slideHref = (index: number) => categories[index]?.href ?? '/collections/all/'
  // Spotlights take the store's third to fifth collections, after the featured rail's and the grid's.
  const spotlight = (index: number, end: boolean) => {
    const c = categories[index]
    return c ? <Spotlight collection={c} picture={paintOf(index)} end={end} /> : null
  }
  const groups = menu.items.filter((item) => item.children.length)
  const viewAll = (
    <Link href="/collections/all/" className={styles.textLink}>
      {t('home.viewAll')}
      <ArrowIcon />
    </Link>
  )
  return (
    <Layout>
      <h1 className={styles.hidden}>{t('home.title')}</h1>
      <HeroCarousel
        slides={[
          { key: 'first', art: art.bannerFirst, href: slideHref(0), label: t('home.hero.first') },
          { key: 'second', art: art.bannerSecond, href: slideHref(1), label: t('home.hero.second') },
          { key: 'third', art: art.bannerThird, href: slideHref(2), label: t('home.hero.third') },
        ]}
        labels={{ region: t('home.hero.region'), role: t('home.hero.role'), previous: t('home.hero.previous'), next: t('home.hero.next'), pause: t('home.hero.pause'), play: t('home.hero.play'), goTo: (n) => t('home.hero.goTo', { n }) }}
      />
      <ProductRail title={t('home.newest')} action={viewAll} products={{ status: newest.status, items: newest.products }} empty={t('home.newestEmpty')} />
      <section className={styles.promises}>
        <h2 className={styles.hidden}>{t('home.promises.title')}</h2>
        <ul className={styles.promiseList}>
          <Pledge title={t('home.promises.craft.title')} body={t('home.promises.craft.body')}>
            <path d="M6 3h12l4 6-10 12L2 9zM2 9h20M12 21L8 9l4-6 4 6z" />
          </Pledge>
          <Pledge title={t('home.promises.stage.title')} body={t('home.promises.stage.body')}>
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 3v4M21 5h-4M5 17v4M7 19H3" />
          </Pledge>
          <Pledge title={t('home.promises.secure.title')} body={t('home.promises.secure.body')}>
            <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" />
          </Pledge>
          <Pledge title={t('home.promises.support.title')} body={t('home.promises.support.body')}>
            <path d="M4 14v-2a8 8 0 0116 0v2M4 14a2 2 0 002 2h1v-5H6a2 2 0 00-2 2zM20 14a2 2 0 01-2 2h-1v-5h1a2 2 0 012 2zM17 16v1a3 3 0 01-3 3h-2" />
          </Pledge>
        </ul>
      </section>
      {status === 'loading' || categories.length ? (
        <section className={styles.section}>
          <SectionHeading eyebrow={t('home.collections.eyebrow')} title={t('home.collections.title')} />
          <ul className={styles.tiles} aria-busy={status === 'loading'}>
            {status === 'loading'
              ? [0, 1, 2, 3].map((i) => (
                  <li key={i}>
                    <span className={styles.tile} />
                  </li>
                ))
              : categories.map((c, index) => (
                  <li key={c.id}>
                    <Link href={c.href} className={cx(styles.tile, art.art, paintOf(index))}>
                      {c.image ? <Image image={c.image} alt="" ratio={0.75} sizes="(min-width: 900px) 25vw, 50vw" className={styles.tileImage} /> : null}
                      <span className={styles.tileFrame} />
                      <span className={styles.tileText}>
                        <span className={styles.tileName}>{c.name}</span>
                        <span className={styles.tileMore}>
                          {t('home.collections.explore')}
                          <ArrowIcon />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
          </ul>
        </section>
      ) : null}
      <Deals collection={categories[1]} />
      {spotlight(2, true)}
      <ProductRail title={t('home.featured')} action={viewAll} products={{ status: featured.status, items: featured.items.slice(0, 8) }} />
      {spotlight(3, false)}
      {spotlight(4, true)}
      <section className={styles.story}>
        <div className={styles.storyFrame}>
          <div className={cx(styles.storyPicture, art.art, art.stone)}>
            {storyImage ? <Image image={storyImage} alt="" ratio={0.8} sizes="(min-width: 900px) 448px, 100vw" className={styles.cover} /> : null}
          </div>
        </div>
        <div className={styles.storyCopy}>
          <p className={styles.eyebrow}>{t('home.story.eyebrow')}</p>
          <h2 className={styles.storyTitle}>
            {t('home.story.title')} <em className={styles.accent}>{t('home.story.accent')}</em>
          </h2>
          <p className={styles.lead}>{t('home.story.lead')}</p>
          <p className={styles.body}>{t('home.story.body')}</p>
          <Link href="/collections/all/" className={styles.button}>
            {t('home.story.more')}
          </Link>
        </div>
      </section>
      {groups.length ? (
        <section className={styles.range}>
          <div className={styles.rangeInner}>
            <SectionHeading eyebrow={t('home.range.eyebrow')} title={t('home.range.title')} />
            <ul className={styles.rangeGrid}>
              {groups.map((group, index) => {
                const at = categories.findIndex((c) => c.href === group.href)
                const match = categories[at]
                return (
                  <li key={group.id} className={styles.rangeCard}>
                    <Link href={group.href} className={cx(styles.rangeHead, art.art, paintOf(at < 0 ? index : at))}>
                      {match?.image ? <Image image={match.image} alt="" ratio={4 / 3} sizes="(min-width: 900px) 25vw, 100vw" className={styles.tileImage} /> : null}
                      <span className={styles.rangeFrame} />
                      <span className={styles.rangeNumber}>{String(index + 1).padStart(2, '0')}</span>
                      <span className={styles.rangeName}>{group.label}</span>
                    </Link>
                    <ul className={styles.rangeLinks}>
                      {group.children.map((child) => (
                        <li key={child.id}>
                          <Link href={child.href} className={styles.rangeLink}>
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link href={group.href} className={styles.rangeAll}>
                      {t('home.range.shopAll', { name: group.label })}
                      <span className={styles.rangeAllIcon}>
                        <ArrowIcon />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      ) : null}
      <section className={cx(styles.signup, art.art, art.sand)}>
        {signupImage ? <Image image={signupImage} alt="" ratio={16 / 9} sizes="100vw" className={cx(styles.cover, styles.signupImage)} /> : null}
        <div className={styles.signupInner}>
          <p className={styles.signupEyebrow}>{t('home.signup.eyebrow')}</p>
          <h2 className={styles.signupTitle}>{t('home.signup.title')}</h2>
          <p className={styles.signupBody}>{t('home.signup.body')}</p>
          <Link href="/register/" className={styles.taupeButton}>
            {t('home.signup.action')}
          </Link>
        </div>
      </section>
    </Layout>
  )
}
