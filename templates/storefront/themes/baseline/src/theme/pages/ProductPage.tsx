import { Breadcrumbs, LegalNotices, Link, Price, useProduct, useStorefront } from '@dripfunnel/storefront-core/theme'
import { BuyButtons } from '../components/interactive/BuyButtons'
import { Gallery } from '../components/interactive/Gallery'
import { Options } from '../components/interactive/Options'
import { Retry } from '../components/interactive/Retry'
import { Layout } from '../components/Layout'
import { Notice } from '../components/Notice'
import { ProductGrid } from '../components/ProductCard'

export const ProductPage = () => {
  const { store, locale, t } = useStorefront()
  const page = useProduct()
  const product = page.product
  if (page.status === 'missing' || page.status === 'error' || !product) {
    return (
      <Layout>
        <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
          {page.status === 'missing' ? (
            <Notice main title={t('shop.product.missing')} lead={t('shop.product.missingLead')}>
              <Link href="/collections/all/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
                {t('shop.collection.browse')}
              </Link>
            </Notice>
          ) : page.status === 'error' ? (
            <Notice main title={t('shop.product.failed')} lead={t('shop.listing.failedLead')}>
              <Retry label={t('shop.listing.retry')} onRetry={page.retry} />
            </Notice>
          ) : (
            <div className="grid gap-y-6 gap-x-6 grid-cols-[minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-y-10 min-[900px]:gap-x-10 min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" aria-busy="true">
              <div className="aspect-[4/5] rounded-card [background:var(--picture-alt)]" />
              <div className="flex min-w-0 flex-col items-start gap-y-3.5 gap-x-3.5">
                <h1 className="m-0 font-heading font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] text-muted text-[20px]">{t('shop.product.loading')}</h1>
              </div>
            </div>
          )}
        </section>
      </Layout>
    )
  }
  const firstMissing = page.missing[0]
  const specs = product.specs.filter((s) => s.versionId === null || s.versionId === page.version?.id)
  return (
    <Layout>
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Breadcrumbs crumbs={[{ label: t('shop.crumbs.home'), href: '/' }, { label: product.name, href: product.href }]} t={t} className="block text-[13px] [--df-sealed-size:13px] [--df-sealed-color:var(--color-muted)] [&::part(link)]:text-ink-soft" />
        <div className="grid gap-y-6 gap-x-6 grid-cols-[minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-y-10 min-[900px]:gap-x-10 min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Gallery photos={page.photos} video={product.video} name={product.name} />
          <div className="flex min-w-0 flex-col items-start gap-y-3.5 gap-x-3.5">
            {product.badges[0] ? <span className="py-0.75 px-2.5 border border-line rounded-full bg-surface text-[12px] font-semibold">{product.badges[0].label}</span> : null}
            <h1 className="m-0 font-heading text-[28px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[32px]">{product.name}</h1>
            {page.price ? (
              <p className="m-0 flex flex-wrap items-baseline gap-y-1.5 gap-x-1.5 text-[20px]">
                {page.from ? <span className="font-bold">{t('shop.card.from')}</span> : null}
                <Price money={page.price} compareAt={page.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} className="inline-block [--df-price-size:20px] [--df-sealed-size:13px] [&::part(amount)]:font-bold [&::part(was)]:ml-2 [&::part(was)]:text-muted [&::part(was)]:text-[16px] [&::part(tax)]:text-muted [&::part(tax)]:text-[13px]" />
              </p>
            ) : null}
            <Options page={page} />
            <p className="m-0 text-ink-soft text-[14px] font-medium" role="status">
              {firstMissing ? t('shop.product.choose', { option: firstMissing.name }) : page.stock?.inStock ? t('shop.product.inStock') : t('shop.product.outOfStock')}
            </p>
            <BuyButtons page={page} />
            {product.highlights.length ? (
              <ul className="pl-4.5 m-0 text-ink-soft">
                {product.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            ) : null}
            <LegalNotices notices={product.legal} t={t} className="block w-full [--df-sealed-size:14px]" />
            <div className="border-t border-t-line w-full">
              {product.description ? (
                <details className="py-3.5 px-0 border-b border-b-line" open>
                  <summary className="min-h-7 font-semibold cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">{t('shop.product.details')}</summary>
                  <p className="mt-2.5 mr-0 mb-0 ml-0 max-w-[60ch] text-ink-soft">{product.description}</p>
                </details>
              ) : null}
              {specs.length ? (
                <details className="py-3.5 px-0 border-b border-b-line">
                  <summary className="min-h-7 font-semibold cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">{t('shop.product.specs')}</summary>
                  <dl className="mt-2.5 mr-0 mb-0 ml-0 grid gap-y-2 gap-x-2">
                    {specs.map((s) => (
                      <div key={`${s.name}-${s.versionId ?? ''}`} className="grid gap-y-0.5 gap-x-0.5 [&_dt]:text-muted [&_dt]:text-[13px] [&_dd]:m-0 [&_dd]:text-ink-soft">
                        <dt>{s.name}</dt>
                        <dd>{s.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
              {product.returns || product.warranty ? (
                <details className="py-3.5 px-0 border-b border-b-line">
                  <summary className="min-h-7 font-semibold cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">{t('shop.product.delivery')}</summary>
                  {product.returns ? <p className="mt-2.5 mr-0 mb-0 ml-0 max-w-[60ch] text-ink-soft">{product.returns}</p> : null}
                  {product.warranty ? (
                    <p className="mt-2.5 mr-0 mb-0 ml-0 max-w-[60ch] text-ink-soft">
                      <strong>{t('shop.product.warranty')}</strong> {product.warranty}
                    </p>
                  ) : null}
                </details>
              ) : null}
              {product.faqs.length ? (
                <details className="py-3.5 px-0 border-b border-b-line">
                  <summary className="min-h-7 font-semibold cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">{t('shop.product.questions')}</summary>
                  <dl className="mt-2.5 mr-0 mb-0 ml-0 grid gap-y-2 gap-x-2">
                    {product.faqs.map((f) => (
                      <div key={f.question} className="grid gap-y-0.5 gap-x-0.5 [&_dt]:text-muted [&_dt]:text-[13px] [&_dd]:m-0 [&_dd]:text-ink-soft">
                        <dt>{f.question}</dt>
                        <dd>{f.answer}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
            </div>
          </div>
        </div>
        {product.related.length ? (
          <section className="pt-10 flex flex-col gap-y-4 gap-x-4 min-[900px]:pt-14">
            <h2 className="m-0 font-heading text-[22px] font-[var(--heading-weight)] leading-[1.2] [text-transform:var(--heading-case)]">{t('shop.product.related')}</h2>
            <ProductGrid products={product.related.slice(0, 4)} wide />
          </section>
        ) : null}
      </section>
    </Layout>
  )
}
