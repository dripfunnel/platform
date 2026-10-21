import { Breadcrumbs, LegalNotices, Link, Price, useProduct, useStorefront } from '@dripfunnel/storefront-core/theme'
import { BuyButtons } from '../components/interactive/BuyButtons'
import { Gallery } from '../components/interactive/Gallery'
import { Options } from '../components/interactive/Options'
import { Retry } from '../components/interactive/Retry'
import { Layout } from '../components/Layout'
import { Notice } from '../components/Notice'
import { ProductGrid } from '../components/ProductCard'
import shop from '../styles/shop.module.css'
import styles from '../styles/product.module.css'

export const ProductPage = () => {
  const { store, locale, t } = useStorefront()
  const page = useProduct()
  const product = page.product
  if (page.status === 'missing' || page.status === 'error' || !product) {
    return (
      <Layout>
        <section className={shop.page}>
          {page.status === 'missing' ? (
            <Notice main title={t('shop.product.missing')} lead={t('shop.product.missingLead')}>
              <Link href="/collections/all/" className={shop.primary}>
                {t('shop.collection.browse')}
              </Link>
            </Notice>
          ) : page.status === 'error' ? (
            <Notice main title={t('shop.product.failed')} lead={t('shop.listing.failedLead')}>
              <Retry label={t('shop.listing.retry')} onRetry={page.retry} />
            </Notice>
          ) : (
            <div className={styles.product} aria-busy="true">
              <div className={styles.noPicture} />
              <div className={styles.info}>
                <h1 className={styles.loadingTitle}>{t('shop.product.loading')}</h1>
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
      <section className={shop.page}>
        <Breadcrumbs crumbs={[{ label: t('shop.crumbs.home'), href: '/' }, { label: product.name, href: product.href }]} t={t} className={shop.crumbs} />
        <div className={styles.product}>
          <Gallery photos={page.photos} video={product.video} name={product.name} />
          <div className={styles.info}>
            {product.badges[0] ? <span className={styles.badge}>{product.badges[0].label}</span> : null}
            <h1 className={styles.title}>{product.name}</h1>
            {page.price ? (
              <p className={styles.price}>
                {page.from ? <span className={styles.from}>{t('shop.card.from')}</span> : null}
                <Price money={page.price} compareAt={page.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} className={styles.priceTag} />
              </p>
            ) : null}
            <Options page={page} />
            <p className={styles.stock} role="status">
              {firstMissing ? t('shop.product.choose', { option: firstMissing.name }) : page.stock?.inStock ? t('shop.product.inStock') : t('shop.product.outOfStock')}
            </p>
            <BuyButtons page={page} />
            {product.highlights.length ? (
              <ul className={styles.highlights}>
                {product.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            ) : null}
            <LegalNotices notices={product.legal} t={t} className={styles.legal} />
            <div className={styles.sections}>
              {product.description ? (
                <details className={styles.section} open>
                  <summary className={styles.summary}>{t('shop.product.details')}</summary>
                  <p className={styles.body}>{product.description}</p>
                </details>
              ) : null}
              {specs.length ? (
                <details className={styles.section}>
                  <summary className={styles.summary}>{t('shop.product.specs')}</summary>
                  <dl className={styles.specs}>
                    {specs.map((s) => (
                      <div key={`${s.name}-${s.versionId ?? ''}`} className={styles.spec}>
                        <dt>{s.name}</dt>
                        <dd>{s.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
              {product.returns || product.warranty ? (
                <details className={styles.section}>
                  <summary className={styles.summary}>{t('shop.product.delivery')}</summary>
                  {product.returns ? <p className={styles.body}>{product.returns}</p> : null}
                  {product.warranty ? (
                    <p className={styles.body}>
                      <strong>{t('shop.product.warranty')}</strong> {product.warranty}
                    </p>
                  ) : null}
                </details>
              ) : null}
              {product.faqs.length ? (
                <details className={styles.section}>
                  <summary className={styles.summary}>{t('shop.product.questions')}</summary>
                  <dl className={styles.specs}>
                    {product.faqs.map((f) => (
                      <div key={f.question} className={styles.faq}>
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
          <section className={styles.related}>
            <h2 className={shop.heading}>{t('shop.product.related')}</h2>
            <ProductGrid products={product.related.slice(0, 4)} wide />
          </section>
        ) : null}
      </section>
    </Layout>
  )
}
