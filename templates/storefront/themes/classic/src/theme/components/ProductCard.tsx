import { Image, Link, Price, useStorefront, type ProductCard as Card } from '@dripfunnel/storefront-core/theme'

export const ProductCard = ({ product }: { product: Card }) => {
  const { store, locale, t } = useStorefront()
  return (
    <article className="group/shop-card pt-2 pr-2 pb-3.5 pl-2 border border-[rgb(179_165_147_/_25%)] flex h-full box-border flex-col items-center gap-y-2 gap-x-2 rounded-[16px] bg-surface [box-shadow:0_1px_2px_rgb(38_34_31_/_6%)] text-center [transition:transform_0.3s_ease,border-color_0.3s_ease,box-shadow_0.3s_ease] hover:border-[rgb(179_165_147_/_60%)] hover:[box-shadow:0_22px_40px_-24px_rgb(47_43_40_/_55%)] hover:[transform:translateY(-4px)]">
      <Link href={product.href} className="flex w-full flex-col items-center gap-y-3 gap-x-3 text-ink no-underline focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[3px]">
        <div className="border border-[rgb(179_165_147_/_45%)] relative overflow-hidden w-full box-border aspect-[4/5] [border-radius:999px_999px_12px_12px] bg-surface group-hover/shop-card:border-taupe">
          {product.photo ? <Image image={product.photo} alt={product.photo.alt ?? product.name} ratio={0.8} sizes="(min-width: 900px) 25vw, 50vw" className="block w-full h-full object-cover bg-soft text-transparent" /> : <span className="absolute top-auto right-2.5 bottom-2.5 left-2.5 text-ink-soft text-[12px]">{t('shop.card.noPicture')}</span>}
          {product.badges[0] ? <span className="py-0.75 px-2.5 absolute top-[18%] left-2.5 rounded-full bg-accent text-accent-ink text-[11px] font-semibold tracking-[0.05em]">{product.badges[0].label}</span> : null}
          {product.stock.inStock ? null : <span className="py-0.75 px-2.5 absolute rounded-full text-[11px] font-semibold tracking-[0.05em] top-auto right-2.5 bottom-2.5 left-auto bg-ink text-bg">{t('shop.card.soldOut')}</span>}
        </div>
        <h3 className="m-0 [display:-webkit-box] overflow-hidden px-1 font-heading text-[17px] font-[var(--heading-weight)] leading-[1.3] wrap-anywhere [-webkit-box-orient:vertical] [-webkit-line-clamp:2] group-hover/shop-card:text-accent group-hover/shop-card:underline group-hover/shop-card:underline-offset-[4px]">{product.name}</h3>
      </Link>
      <span className="w-[min(100%,112px)] h-2 [background:conic-gradient(from_45deg_at_50%_50%,var(--color-taupe)_90deg,transparent_0)_center_/_6px_6px_no-repeat,linear-gradient(to_right,transparent,var(--color-taupe)_42%,transparent_42%_58%,var(--color-taupe)_58%,transparent)_center_/_100%_1px_no-repeat]" aria-hidden="true" />
      {product.price ? (
        <p className="m-0 flex flex-wrap items-baseline justify-center gap-y-1 gap-x-1 text-accent text-[15px]">
          {product.from ? <span className="font-semibold">{t('shop.card.from')}</span> : null}
          <Price money={product.price} compareAt={product.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} className="inline-block [--df-price-size:16px] [--df-sealed-color:var(--color-accent)] [--df-sealed-size:12px] [&::part(amount)]:font-bold [&::part(was)]:ml-1.5 [&::part(was)]:text-muted [&::part(was)]:text-[13px] [&::part(tax)]:text-muted [&::part(tax)]:text-[12px]" />
        </p>
      ) : null}
      <Link href={product.href} className="pt-1 mt-auto inline-flex items-center gap-y-1 gap-x-1 text-muted text-[11px] font-medium tracking-[0.2em] no-underline uppercase group-hover/shop-card:text-accent group-hover/shop-card:underline group-hover/shop-card:underline-offset-[4px] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
        {t('shop.card.view')}
        <svg className="w-3 h-3 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2] [transition:transform_0.3s_ease] group-hover/shop-card:[transform:translateX(2px)]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </Link>
    </article>
  )
}

export const ProductGrid = ({ products, wide = false }: { products: readonly Card[]; wide?: boolean }) => (
  <ul className={wide ? 'p-0 m-0 grid gap-y-6 gap-x-3.5 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:gap-y-8 min-[900px]:gap-x-4.5 min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))]' : 'p-0 m-0 grid gap-y-6 gap-x-3.5 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:group-[:nth-child(n)]/shop-listing:grid-cols-[repeat(4,minmax(0,1fr))] min-[900px]:gap-y-8 min-[900px]:gap-x-4.5 min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))]'}>
    {products.map((p) => (
      <li key={p.id} className="min-w-0">
        <ProductCard product={p} />
      </li>
    ))}
  </ul>
)

/** The grid's shape while its products load, so nothing moves when they arrive. */
export const GridPlaceholder = ({ label, count }: { label: string; count: number }) => (
  <ul className="p-0 m-0 grid gap-y-6 gap-x-3.5 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:group-[:nth-child(n)]/shop-listing:grid-cols-[repeat(4,minmax(0,1fr))] min-[900px]:gap-y-8 min-[900px]:gap-x-4.5 min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))]" aria-busy="true" aria-label={label}>
    {[...Array(count).keys()].map((i) => (
      <li key={i} className="min-w-0">
        <div className="aspect-[4/5] [border-radius:999px_999px_8px_8px] bg-soft" />
        <div className="mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft" />
      </li>
    ))}
  </ul>
)
