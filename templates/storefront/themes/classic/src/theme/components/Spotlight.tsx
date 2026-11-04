import { Image, Link, useListing, useStorefront, type CollectionCard } from '@dripfunnel/storefront-core/theme'
import { Ornament } from './Ornament'
import { ProductCard } from './ProductCard'
import { clsx } from 'clsx'
import { slugOf } from './slugOf'

type SpotlightProps = {
  collection: CollectionCard
  /** The class that paints the banner's placeholder until the collection has a picture. */
  picture: string | undefined
  /** The banner sits left of the products, or right of them from tablet width up. */
  end?: boolean
}

/**
 * A collection's banner beside four of its products, between two temple-border bands.
 * Hidden until the collection has products, so an empty collection leaves no gap.
 */
export const Spotlight = ({ collection, picture, end = false }: SpotlightProps) => {
  const { t } = useStorefront()
  const { items } = useListing({ collection: slugOf(collection) })
  if (!items.length) return null
  return (
    <section className="bg-soft">
      <div className="border-t-[2px] border-t-taupe h-3 box-border [background:conic-gradient(from_135deg_at_50%_0,var(--color-taupe)_90deg,transparent_0)_bottom_/_16px_8px_repeat-x,var(--color-deep)]" />
      <div className={clsx('py-14 px-4 grid box-border w-[min(100%,1240px)] items-start gap-y-6 gap-x-6 mx-auto min-[768px]:py-20 min-[768px]:px-8 min-[768px]:gap-y-10 min-[768px]:gap-x-10 min-[768px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]', end && 'group/home-spotlightEnd')}>
        <div className="min-[768px]:sticky min-[768px]:top-24 min-[768px]:group-[:nth-child(n)]/home-spotlightEnd:[order:1]">
          <div className={clsx("relative overflow-hidden aspect-[1] rounded-[16px] bg-deep text-[#fff] [&::before]:absolute [&::before]:z-[1] [&::before]:inset-0 [&::before]:[background:linear-gradient(to_top,var(--color-deep)_30%,rgb(47_43_40_/_80%)_55%,transparent_90%)] [&::before]:[content:''] [&::after]:absolute [&::after]:z-[1] [&::after]:inset-0 [&::after]:[background:radial-gradient(rgb(179_165_147_/_35%)_1px,transparent_1.6px)_0_0_/_22px_22px] [&::after]:[content:''] [&::after]:opacity-[0.2]", 'bg-soft [background-position:center] [background-repeat:no-repeat] [background-size:cover]', picture)}>
            {collection.image ? <Image image={collection.image} alt="" ratio={1} sizes="(min-width: 768px) 50vw, 100vw" className="absolute inset-0 block w-full h-full object-cover" /> : null}
            <span className="border border-[rgb(179_165_147_/_70%)] absolute z-[2] top-3 right-3 bottom-3 left-3 rounded-[12px] min-[640px]:top-4 min-[640px]:right-4 min-[640px]:bottom-4 min-[640px]:left-4" />
            <div className="group/home-spotlightCopy absolute z-[2] right-6 bottom-7 left-6 flex flex-col items-center text-center min-[640px]:right-10 min-[640px]:bottom-10 min-[640px]:left-10">
              <p className="m-0 text-taupe text-[10px] font-semibold tracking-[0.25em] uppercase min-[640px]:text-[12px]">{t('home.spotlight.eyebrow')}</p>
              <h2 className="mt-2 mr-0 mb-0 ml-0 font-heading text-[26px] font-[var(--heading-weight)] leading-[1.1] [text-wrap:balance] min-[640px]:text-[30px] min-[900px]:text-[36px]">{collection.name}</h2>
              <Ornament className="mt-3 block w-[min(100%,160px)] h-2.5 text-taupe" />
              <p className="mt-3 mr-0 mb-0 ml-0 hidden max-w-[24rem] text-[rgb(255_255_255_/_85%)] text-[14px] leading-[1.6] min-[640px]:block min-[768px]:hidden min-[900px]:block">{collection.description || t('home.spotlight.body')}</p>
              <Link href={collection.href} className="py-0 px-6 border border-taupe inline-flex min-h-11 box-border items-center justify-center rounded-button text-[12px] font-semibold tracking-[0.15em] no-underline uppercase min-w-45 bg-taupe text-taupe-ink hover:[filter:brightness(0.94)] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] group-[:nth-child(n)]/home-spotlightCopy:mt-5">
                {t('home.spotlight.cta', { name: collection.name })}
              </Link>
            </div>
          </div>
        </div>
        <ul className="p-0 m-0 grid gap-y-3 gap-x-3 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[640px]:gap-y-4 min-[640px]:gap-x-4 min-[900px]:gap-y-6 min-[900px]:gap-x-6">
          {items.slice(0, 4).map((product) => (
            <li key={product.id}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      </div>
      <div className={clsx('border-t-[2px] border-t-taupe h-3 box-border [background:conic-gradient(from_135deg_at_50%_0,var(--color-taupe)_90deg,transparent_0)_bottom_/_16px_8px_repeat-x,var(--color-deep)]', '[transform:scaleY(-1)]')} />
    </section>
  )
}
