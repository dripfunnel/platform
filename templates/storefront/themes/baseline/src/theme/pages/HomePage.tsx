import { Image, Link, MerchantImage, useCollections, useProducts, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { GridPlaceholder, ProductGrid } from '../components/ProductCard'

export const HomePage = () => {
  const { store, t } = useStorefront()
  const { collections, status } = useCollections({ first: 4 })
  const newest = useProducts({ sort: 'newest', first: 4 })
  return (
    <Layout>
      <section className="grid grid-cols-[minmax(0,1fr)] min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="py-9 px-5 flex flex-col items-start justify-center gap-y-3.5 gap-x-3.5 bg-tint min-[900px]:py-14 min-[900px]:px-12">
          <p className="m-0 text-muted text-[12px] tracking-[0.12em] uppercase">{t('home.hero.eyebrow')}</p>
          <h1 className="m-0 max-w-[16ch] font-heading text-[36px] font-[var(--heading-weight)] tracking-[-0.01em] leading-[1.12] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[52px]">{t('home.hero.title', { store: store.name })}</h1>
          <p className="m-0 max-w-[42ch] text-ink-soft text-[17px] wrap-anywhere">{store.description ?? t('home.hero.lead')}</p>
          <div className="flex flex-wrap gap-y-3 gap-x-3">
            <Link href="/collections/all/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center rounded-button bg-accent text-accent-ink text-[15px] font-semibold no-underline hover:[filter:brightness(0.94)] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
              {t('home.hero.shop')}
            </Link>
            <Link href="/about/" className="py-0 px-5.5 border border-ink-soft inline-flex min-h-12 items-center justify-center rounded-button text-[15px] font-semibold no-underline bg-transparent text-ink focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
              {t('home.hero.story')}
            </Link>
          </div>
        </div>
        <div className="min-h-65 [background:var(--picture)] min-[900px]:min-h-110">
          <MerchantImage asset={t('home.hero.image')} alt={t('home.hero.imageAlt')} ratio={1} sizes="(min-width: 900px) 50vw, 100vw" className="block w-full h-full object-cover" />
        </div>
      </section>
      <section className="pt-12 pr-4 pb-0 pl-4 grid box-border grid-cols-[minmax(0,1fr)] w-[min(100%,1240px)] items-center gap-y-6 gap-x-6 mx-auto min-[900px]:pt-18 min-[900px]:pr-8 min-[900px]:pb-0 min-[900px]:pl-8 min-[900px]:gap-y-14 min-[900px]:gap-x-14 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-h-60 rounded-card [background:var(--picture-alt)] min-[900px]:min-h-105" />
        <div className="flex flex-col items-start gap-y-3.5 gap-x-3.5">
          <p className="m-0 text-muted text-[12px] tracking-[0.12em] uppercase">{t('home.story.eyebrow')}</p>
          <h2 className="m-0 font-heading text-[26px] font-[var(--heading-weight)] leading-[1.2] [text-transform:var(--heading-case)] min-[900px]:text-[30px]">{t('home.story.title')}</h2>
          <p className="m-0 max-w-[52ch] text-ink-soft text-[16px]">{t('home.story.body')}</p>
          <Link href="/about/" className="py-0 px-5.5 border border-ink-soft inline-flex min-h-12 items-center justify-center rounded-button text-[15px] font-semibold no-underline bg-transparent text-ink focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
            {t('home.story.more')}
          </Link>
        </div>
      </section>
      <section className="p-6 mt-14 mr-auto mb-0 ml-auto border border-line flex box-border w-[min(100%_-_32px,640px)] flex-col items-center gap-y-3 gap-x-3 rounded-card bg-surface text-center">
        <h2 className="m-0 font-heading text-[26px] font-[var(--heading-weight)] leading-[1.2] [text-transform:var(--heading-case)] min-[900px]:text-[30px]">{t('home.signup.title')}</h2>
        <p className="m-0 max-w-[52ch] text-ink-soft text-[16px]">{t('home.signup.body')}</p>
        <Link href="/register/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center rounded-button bg-accent text-accent-ink text-[15px] font-semibold no-underline hover:[filter:brightness(0.94)] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
          {t('home.signup.action')}
        </Link>
      </section>
      {status === 'loading' || collections.length ? (
        <section className="group/shop-band pt-10 pr-4 pb-0 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-14 min-[900px]:pr-8 min-[900px]:pb-0 min-[900px]:pl-8">
          <h2 className="m-0 font-heading text-[22px] font-[var(--heading-weight)] leading-[1.2] [text-transform:var(--heading-case)]">{t('home.collections.title')}</h2>
          {status === 'loading' ? (
            <ul className="p-0 m-0 grid gap-y-3.5 gap-x-3.5 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))]" aria-busy="true" aria-label={t('shop.listing.loading')}>
              {[0, 1, 2, 3].map((i) => (
                <li key={i}>
                  <span className="relative block overflow-hidden aspect-[1] rounded-card [background:var(--picture-alt)] text-ink no-underline focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[3px]" />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="p-0 m-0 grid gap-y-3.5 gap-x-3.5 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))]">
              {collections.map((c) => (
                <li key={c.id}>
                  <Link href={c.href} className="relative block overflow-hidden aspect-[1] rounded-card [background:var(--picture-alt)] text-ink no-underline focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[3px]">
                    {c.image ? <Image image={c.image} alt={c.name} ratio={1} sizes="(min-width: 900px) 25vw, 50vw" className="block w-full h-full object-cover" /> : null}
                    <span className="py-1.5 px-3 absolute bottom-3 left-3 rounded-full bg-surface text-[14px] font-semibold">{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {newest.status === 'loading' || newest.products.length ? (
        <section className="group/shop-band pt-10 pr-4 pb-0 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-14 min-[900px]:pr-8 min-[900px]:pb-0 min-[900px]:pl-8">
          <div className="flex items-baseline justify-between gap-y-3 gap-x-3">
            <h2 className="m-0 font-heading text-[22px] font-[var(--heading-weight)] leading-[1.2] [text-transform:var(--heading-case)]">{t('home.newest.title')}</h2>
            <Link href="/collections/all/?sort=newest" className="text-ink text-[14px] underline-offset-[3px] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
              {t('home.newest.all')}
            </Link>
          </div>
          {newest.status === 'loading' ? <GridPlaceholder label={t('shop.listing.loading')} count={4} /> : <ProductGrid products={newest.products} />}
        </section>
      ) : null}
    </Layout>
  )
}
