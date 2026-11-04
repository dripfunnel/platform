import type { ReactNode } from 'react'
import { Image, Link, useCollections, useListing, useMenu, useProducts, useStorefront, type CollectionCard, type ProductCard as Card } from '@dripfunnel/storefront-core/theme'
import { HeroCarousel } from '../components/interactive/HeroCarousel'
import { Layout } from '../components/Layout'
import { ProductCard } from '../components/ProductCard'
import { SectionHeading } from '../components/SectionHeading'
import { Spotlight } from '../components/Spotlight'
import { clsx } from 'clsx'
import { slugOf } from '../components/slugOf'

/** The painted placeholder behind a collection's picture, in turn by its place in the store's list. */
const paints = ['[background-image:linear-gradient(160deg,#8a8178,#4a4541)] [background-position:center_25%]', '[background-image:linear-gradient(160deg,#a39482,#5e554b)]', '[background-image:linear-gradient(160deg,#73777b,#3c3f42)]', '[background-image:linear-gradient(160deg,#7d8577,#454a41)] [background-position:center_25%]']
const paintOf = (index: number) => paints[index % paints.length]

const Pledge = ({ title, body, children }: { title: string; body: string; children: ReactNode }) => (
  <li className="flex flex-col items-center gap-y-3 gap-x-3 text-center">
    <span className="border border-[rgb(179_165_147_/_50%)] inline-flex w-14 h-14 box-border items-center justify-center rounded-full text-accent [&_svg]:w-6 [&_svg]:h-6 [&_svg]:[fill:none] [&_svg]:[stroke:currentcolor] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.5]" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {children}
      </svg>
    </span>
    <h3 className="m-0 font-heading text-[20px] font-[var(--heading-weight)]">{title}</h3>
    <p className="m-0 max-w-[16rem] text-muted text-[14px] leading-[1.6]">{body}</p>
  </li>
)

const ArrowIcon = () => (
  <svg className="w-3.5 h-3.5 shrink-0 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2] [transition:transform_0.3s_ease] group-hover/home-textLink:[transform:translateX(3px)] group-hover/home-pill:[transform:translateX(3px)] group-hover/home-tile:[transform:translateX(3px)] group-hover/home-rangeAll:[transform:translateX(3px)]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

/** The rail's one row of grey cards, in the shape its products arrive in: loading, or with a note when there are none. */
const RailPlaceholder = ({ label, note }: { label: string; note: string | null }) => (
  <div className="relative">
    <ul className="pt-0 pr-0 pb-2 pl-0 m-0 grid gap-y-3 gap-x-3 [grid-auto-columns:calc((100%_-_12px)_/_2)] [grid-auto-flow:column] list-none overflow-x-auto [overscroll-behavior-x:contain] [scroll-snap-type:x_proximity] [scrollbar-width:none] min-[768px]:[grid-auto-columns:calc((100%_-_32px)_/_3)] min-[768px]:gap-y-4 min-[768px]:gap-x-4 min-[1280px]:[grid-auto-columns:calc((100%_-_72px)_/_4)] min-[1280px]:gap-y-6 min-[1280px]:gap-x-6" aria-hidden={note ? true : undefined} aria-busy={note ? undefined : true} aria-label={note ? undefined : label}>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="min-w-0 [scroll-snap-align:start]">
          <div className="aspect-[4/5] [border-radius:999px_999px_8px_8px] bg-soft" />
          <div className="mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft" />
        </li>
      ))}
    </ul>
    {note ? <p className="p-4 m-0 absolute inset-0 grid [place-items:center] text-ink-soft text-[15px] text-center">{note}</p> : null}
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
    <section className="py-12 px-4 box-border w-[min(100%,1240px)] mx-auto min-[900px]:py-16 min-[900px]:px-8">
      <div className="mb-8 flex items-end justify-between gap-y-4 gap-x-4">
        <h2 className="m-0 font-heading text-[30px] font-bold leading-[1.1] min-[900px]:text-[36px]">{title}</h2>
        {none ? null : action}
      </div>
      {products.status === 'loading' || none ? (
        <RailPlaceholder label={t('shop.listing.loading')} note={none ? (empty ?? null) : null} />
      ) : (
        <ul className="pt-0 pr-0 pb-2 pl-0 m-0 grid gap-y-3 gap-x-3 [grid-auto-columns:calc((100%_-_12px)_/_2)] [grid-auto-flow:column] list-none overflow-x-auto [overscroll-behavior-x:contain] [scroll-snap-type:x_proximity] [scrollbar-width:none] min-[768px]:[grid-auto-columns:calc((100%_-_32px)_/_3)] min-[768px]:gap-y-4 min-[768px]:gap-x-4 min-[1280px]:[grid-auto-columns:calc((100%_-_72px)_/_4)] min-[1280px]:gap-y-6 min-[1280px]:gap-x-6">
          {products.items.map((product) => (
            <li key={product.id} className="min-w-0 [scroll-snap-align:start]">
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
    <section className="py-16 px-4 box-border w-[min(100%,1240px)] mx-auto min-[900px]:py-24 min-[900px]:px-8">
      <SectionHeading eyebrow={t('home.deals.eyebrow')} title={collection.name} />
      <ul className="p-0 m-0 grid gap-y-4 gap-x-4 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:gap-y-6 min-[900px]:gap-x-6 min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))]">
        {items.slice(0, 8).map((product) => (
          <li key={product.id}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
      <div className="mt-10 flex justify-center">
        <Link href={collection.href} className="group/home-pill py-0 px-6 border border-[rgb(179_165_147_/_60%)] inline-flex min-h-11 box-border items-center gap-y-1.5 gap-x-1.5 rounded-full text-accent text-[14px] font-medium no-underline hover:bg-[rgb(179_165_147_/_10%)] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
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
    <Link href="/collections/all/" className="group/home-textLink inline-flex items-center gap-y-1.5 gap-x-1.5 text-accent text-[13px] font-semibold no-underline whitespace-nowrap focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
      {t('home.viewAll')}
      <ArrowIcon />
    </Link>
  )
  return (
    <Layout>
      <h1 className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{t('home.title')}</h1>
      <HeroCarousel
        slides={[
          { key: 'first', art: 'first', href: slideHref(0), label: t('home.hero.first') },
          { key: 'second', art: 'second', href: slideHref(1), label: t('home.hero.second') },
          { key: 'third', art: 'third', href: slideHref(2), label: t('home.hero.third') },
        ]}
        labels={{ region: t('home.hero.region'), role: t('home.hero.role'), previous: t('home.hero.previous'), next: t('home.hero.next'), pause: t('home.hero.pause'), play: t('home.hero.play'), goTo: (n) => t('home.hero.goTo', { n }) }}
      />
      <ProductRail title={t('home.newest')} action={viewAll} products={{ status: newest.status, items: newest.products }} empty={t('home.newestEmpty')} />
      <section className="[border-block:1px_solid_rgb(179_165_147_/_30%)] bg-surface">
        <h2 className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{t('home.promises.title')}</h2>
        <ul className="py-12 px-4 my-0 mx-auto grid box-border w-[min(100%,1240px)] gap-y-8 gap-x-8 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:py-16 min-[900px]:px-8 min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))]">
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
        <section className="py-16 px-4 box-border w-[min(100%,1240px)] mx-auto min-[900px]:py-24 min-[900px]:px-8">
          <SectionHeading eyebrow={t('home.collections.eyebrow')} title={t('home.collections.title')} />
          <ul className="p-0 m-0 grid gap-y-4 gap-x-4 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:gap-y-6 min-[900px]:gap-x-6 min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))]" aria-busy={status === 'loading'}>
            {status === 'loading'
              ? [0, 1, 2, 3].map((i) => (
                  <li key={i}>
                    <span className="group/home-tile focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] relative block overflow-hidden aspect-[3/4] rounded-card bg-soft [box-shadow:0_0_0_1px_rgb(179_165_147_/_25%)] text-[#fff] no-underline [&::after]:absolute [&::after]:inset-0 [&::after]:[background:linear-gradient(to_top,rgb(0_0_0_/_80%),rgb(0_0_0_/_15%)_55%,transparent)] [&::after]:[content:'']" />
                  </li>
                ))
              : categories.map((c, index) => (
                  <li key={c.id}>
                    <Link href={c.href} className={clsx("group/home-tile focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] relative block overflow-hidden aspect-[3/4] rounded-card bg-soft [box-shadow:0_0_0_1px_rgb(179_165_147_/_25%)] text-[#fff] no-underline [&::after]:absolute [&::after]:inset-0 [&::after]:[background:linear-gradient(to_top,rgb(0_0_0_/_80%),rgb(0_0_0_/_15%)_55%,transparent)] [&::after]:[content:'']", 'bg-soft [background-position:center] [background-repeat:no-repeat] [background-size:cover]', paintOf(index))}>
                      {c.image ? <Image image={c.image} alt="" ratio={0.75} sizes="(min-width: 900px) 25vw, 50vw" className="[transition:transform_0.7s_ease] absolute inset-0 block w-full h-full object-cover group-hover/home-tile:[transform:scale(1.05)]" /> : null}
                      <span className="border border-[rgb(179_165_147_/_60%)] absolute z-[1] top-2 right-2 bottom-2 left-2 rounded-[6px] opacity-[0] [transition:opacity_0.5s_ease] group-hover/home-tile:opacity-[1]" />
                      <span className="p-4 absolute z-[1] right-0 bottom-0 left-0 flex flex-col items-center gap-y-2 gap-x-2 text-center">
                        <span className="font-heading text-[24px] font-[var(--heading-weight)] leading-[1.1] min-[900px]:text-[30px]">{c.name}</span>
                        <span className="inline-flex items-center gap-y-1.5 gap-x-1.5 text-taupe text-[11px] tracking-[0.2em] uppercase min-[900px]:text-[12px]">
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
      <section className="py-16 px-4 grid box-border w-[min(100%,1240px)] items-center gap-y-12 gap-x-12 grid-cols-[minmax(0,1fr)] mx-auto min-[900px]:py-24 min-[900px]:px-8 min-[900px]:gap-y-16 min-[900px]:gap-x-16 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative w-[min(100%,448px)] mx-auto [&::before]:border [&::before]:border-[rgb(179_165_147_/_50%)] [&::before]:absolute [&::before]:inset-0 [&::before]:rounded-card [&::before]:[content:''] [&::before]:[transform:translate(8px,8px)] min-[768px]:[&::before]:[transform:translate(16px,16px)]">
          <div className={clsx('relative overflow-hidden aspect-[4/5] rounded-card', 'bg-soft [background-position:center] [background-repeat:no-repeat] [background-size:cover]', '[background-image:linear-gradient(160deg,#8a8178,#4a4541)] [background-position:center_25%]')}>
            {storyImage ? <Image image={storyImage} alt="" ratio={0.8} sizes="(min-width: 900px) 448px, 100vw" className="absolute inset-0 block w-full h-full object-cover" /> : null}
          </div>
        </div>
        <div className="flex flex-col items-start gap-y-6 gap-x-6">
          <p className="m-0 text-accent text-[12px] font-semibold tracking-[0.25em] uppercase">{t('home.story.eyebrow')}</p>
          <h2 className="m-0 font-heading text-[36px] font-[var(--heading-weight)] leading-[1.15] [text-wrap:balance] min-[900px]:text-[48px]">
            {t('home.story.title')} <em className="text-taupe-text">{t('home.story.accent')}</em>
          </h2>
          <p className="m-0 max-w-[52ch] text-muted text-[18px] leading-[1.7]">{t('home.story.lead')}</p>
          <p className="m-0 max-w-[52ch] text-muted text-[16px] leading-[1.7]">{t('home.story.body')}</p>
          <Link href="/collections/all/" className="py-0 px-6 border border-accent inline-flex min-w-50 min-h-11 box-border items-center justify-center rounded-button bg-accent text-accent-ink text-[12px] font-semibold tracking-[0.15em] no-underline uppercase hover:[filter:brightness(0.94)] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
            {t('home.story.more')}
          </Link>
        </div>
      </section>
      {groups.length ? (
        <section className="bg-[rgb(242_239_234_/_60%)]">
          <div className="py-16 px-4 box-border w-[min(100%,1240px)] mx-auto min-[900px]:py-24 min-[900px]:px-8">
            <SectionHeading eyebrow={t('home.range.eyebrow')} title={t('home.range.title')} />
            <ul className="p-0 m-0 grid gap-y-6 gap-x-6 grid-cols-[minmax(0,1fr)] list-none min-[640px]:grid-cols-[repeat(2,minmax(0,1fr))] min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))]">
              {groups.map((group, index) => {
                const at = categories.findIndex((c) => c.href === group.href)
                const match = categories[at]
                return (
                  <li key={group.id} className="flex overflow-hidden flex-col rounded-[16px] bg-surface [box-shadow:0_0_0_1px_rgb(179_165_147_/_25%),0_1px_2px_rgb(38_34_31_/_6%),0_8px_24px_-12px_rgb(38_34_31_/_18%)] [transition:transform_0.5s_ease] hover:[transform:translateY(-4px)]">
                    <Link href={group.href} className={clsx("focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] relative block overflow-hidden aspect-[4/3] bg-footer-bg text-[#fff] no-underline [&::after]:absolute [&::after]:inset-0 [&::after]:[background:linear-gradient(to_top,var(--color-footer-bg),rgb(38_34_31_/_35%),transparent)] [&::after]:[content:'']", 'bg-soft [background-position:center] [background-repeat:no-repeat] [background-size:cover]', paintOf(at < 0 ? index : at))}>
                      {match?.image ? <Image image={match.image} alt="" ratio={4 / 3} sizes="(min-width: 900px) 25vw, 100vw" className="[transition:transform_0.7s_ease] absolute inset-0 block w-full h-full object-cover group-hover/home-tile:[transform:scale(1.05)]" /> : null}
                      <span className="border border-[rgb(179_165_147_/_40%)] absolute z-[1] top-3 right-3 bottom-3 left-3 rounded-[12px]" />
                      <span className="absolute z-[1] top-5 left-6 text-[rgb(179_165_147_/_90%)] font-heading text-[18px] italic">{String(index + 1).padStart(2, '0')}</span>
                      <span className="pb-3 absolute z-[1] right-6 bottom-6 left-6 [background:linear-gradient(var(--color-taupe),var(--color-taupe))_left_bottom_/_40px_1px_no-repeat] font-heading text-[28px] font-[var(--heading-weight)] leading-[1.15]">{group.label}</span>
                    </Link>
                    <ul className="p-3 m-0 flex-1 list-none">
                      {group.children.map((child) => (
                        <li key={child.id}>
                          <Link href={child.href} className="focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] py-0 px-3 flex min-h-10 items-center gap-y-3 gap-x-3 rounded-card text-[rgb(42_39_37_/_75%)] text-[14px] no-underline [&::before]:w-1.5 [&::before]:h-1.5 [&::before]:shrink-0 [&::before]:bg-[rgb(179_165_147_/_70%)] [&::before]:[content:''] [&::before]:[transform:rotate(45deg)] hover:bg-soft hover:text-accent">
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link href={group.href} className="group/home-rangeAll focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] pt-4 mt-0 mr-6 mb-6 ml-6 border-t border-t-[rgb(179_165_147_/_30%)] flex items-center justify-between gap-y-3 gap-x-3 text-accent text-[12px] font-semibold tracking-[0.16em] no-underline uppercase">
                      {t('home.range.shopAll', { name: group.label })}
                      <span className="border border-[rgb(179_165_147_/_50%)] inline-flex w-8 h-8 shrink-0 box-border items-center justify-center rounded-full group-hover/home-rangeAll:border-accent group-hover/home-rangeAll:bg-accent group-hover/home-rangeAll:text-accent-ink">
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
      <section className={clsx("relative bg-deep [background-position:right_center] text-[#fff] [&::before]:absolute [&::before]:z-[1] [&::before]:inset-0 [&::before]:[background:linear-gradient(to_right,var(--color-deep),rgb(47_43_40_/_90%),rgb(47_43_40_/_30%))] [&::before]:[content:'']", 'bg-soft [background-position:center] [background-repeat:no-repeat] [background-size:cover]', '[background-image:linear-gradient(160deg,#a39482,#5e554b)]')}>
        {signupImage ? <Image image={signupImage} alt="" ratio={16 / 9} sizes="100vw" className={clsx('absolute inset-0 block w-full h-full object-cover', 'object-[right_center] opacity-[0.4]')} /> : null}
        <div className="py-16 px-4 relative z-[2] flex box-border w-[min(100%,1240px)] flex-col items-start mx-auto min-[900px]:py-24 min-[900px]:px-8">
          <p className="mt-0 mr-0 mb-3 ml-0 wrap-anywhere text-taupe text-[12px] font-semibold tracking-[0.25em] uppercase">{t('home.signup.eyebrow')}</p>
          <h2 className="mt-0 mr-0 mb-4 ml-0 max-w-[14ch] font-heading text-[32px] font-[var(--heading-weight)] leading-[1.1] min-[900px]:text-[48px]">{t('home.signup.title')}</h2>
          <p className="mt-0 mr-0 mb-8 ml-0 max-w-[36rem] text-[rgb(255_255_255_/_80%)] leading-[1.7]">{t('home.signup.body')}</p>
          <Link href="/register/" className="py-0 px-6 border border-taupe inline-flex min-h-11 box-border items-center justify-center rounded-button text-[12px] font-semibold tracking-[0.15em] no-underline uppercase min-w-45 bg-taupe text-taupe-ink hover:[filter:brightness(0.94)] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] group-[:nth-child(n)]/home-spotlightCopy:mt-5">
            {t('home.signup.action')}
          </Link>
        </div>
      </section>
    </Layout>
  )
}
