import { Image, Link, Price, useStorefront, type ProductCard as Card } from '@dripfunnel/storefront-core/theme'

export const ProductCard = ({ product }: { product: Card }) => {
  const { store, locale, t } = useStorefront()
  return (
    <article className="flex flex-col gap-y-1.5 gap-x-1.5">
      <Link href={product.href} className="flex flex-col gap-y-2.5 gap-x-2.5 text-ink no-underline focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[3px]">
        <div className="relative overflow-hidden aspect-[4/5] rounded-card [background:var(--picture-alt)]">
          {product.photo ? <Image image={product.photo} alt={product.photo.alt ?? product.name} ratio={0.8} sizes="(min-width: 900px) 25vw, 50vw" className="block w-full h-full object-cover" /> : <span className="absolute top-auto right-2.5 bottom-2.5 left-2.5 text-ink-soft text-[12px]">{t('shop.card.noPicture')}</span>}
          {product.badges[0] ? <span className="py-0.75 px-2.5 absolute top-2.5 left-2.5 rounded-full bg-surface text-ink text-[12px] font-semibold">{product.badges[0].label}</span> : null}
          {product.stock.inStock ? null : <span className="py-0.75 px-2.5 absolute rounded-full text-[12px] font-semibold top-auto right-2.5 bottom-2.5 left-auto bg-ink text-bg">{t('shop.card.soldOut')}</span>}
        </div>
        <h3 className="m-0 font-body text-[15px] font-medium wrap-anywhere">{product.name}</h3>
      </Link>
      {product.price ? (
        <p className="m-0 flex flex-wrap items-baseline gap-y-1 gap-x-1 text-[15px]">
          {product.from ? <span className="font-semibold">{t('shop.card.from')}</span> : null}
          <Price money={product.price} compareAt={product.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} className="inline-block [--df-price-size:15px] [--df-sealed-size:12px] [&::part(amount)]:font-bold [&::part(was)]:ml-1.5 [&::part(was)]:text-muted [&::part(was)]:text-[13px] [&::part(tax)]:text-muted [&::part(tax)]:text-[12px]" />
        </p>
      ) : null}
    </article>
  )
}

export const ProductGrid = ({ products, wide = false }: { products: readonly Card[]; wide?: boolean }) => (
  <ul className={wide ? 'p-0 m-0 grid gap-y-6 gap-x-3.5 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:gap-y-8 min-[900px]:gap-x-4.5 min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))]' : 'p-0 m-0 grid gap-y-6 gap-x-3.5 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:group-[:nth-child(n)]/shop-listing:grid-cols-[repeat(4,minmax(0,1fr))] min-[900px]:gap-y-8 min-[900px]:gap-x-4.5 min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))] min-[900px]:group-[:nth-child(n)]/shop-band:grid-cols-[repeat(4,minmax(0,1fr))]'}>
    {products.map((p) => (
      <li key={p.id} className="min-w-0">
        <ProductCard product={p} />
      </li>
    ))}
  </ul>
)

/** The grid's shape while its products load, so nothing moves when they arrive. */
export const GridPlaceholder = ({ label, count }: { label: string; count: number }) => (
  <ul className="p-0 m-0 grid gap-y-6 gap-x-3.5 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:group-[:nth-child(n)]/shop-listing:grid-cols-[repeat(4,minmax(0,1fr))] min-[900px]:gap-y-8 min-[900px]:gap-x-4.5 min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))] min-[900px]:group-[:nth-child(n)]/shop-band:grid-cols-[repeat(4,minmax(0,1fr))]" aria-busy="true" aria-label={label}>
    {[...Array(count).keys()].map((i) => (
      <li key={i} className="min-w-0">
        <div className="aspect-[4/5] rounded-card bg-soft" />
        <div className="mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft" />
      </li>
    ))}
  </ul>
)
