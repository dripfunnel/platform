import { Breadcrumbs, Link, useCollection, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { ListingResults } from '../components/ListingResults'
import { Notice } from '../components/Notice'
import { Retry } from '../components/interactive/Retry'
import styles from '../styles/shop.module.css'

export const CollectionPage = () => {
  const { t } = useStorefront()
  const page = useCollection()
  const name = page.collection?.name ?? (page.all ? t('shop.collection.all') : null)
  const lead = page.collection ? page.collection.description : page.all ? t('shop.collection.allLead') : null
  return (
    <Layout>
      <section className={styles.page}>
        {page.found === 'missing' ? (
          <Notice main title={t('shop.collection.missing')} lead={t('shop.collection.missingLead')}>
            <Link href="/collections/all/" className={styles.primary}>
              {t('shop.collection.browse')}
            </Link>
          </Notice>
        ) : page.found === 'error' ? (
          <Notice main title={t('shop.listing.failed')} lead={t('shop.listing.failedLead')}>
            <Retry label={t('shop.listing.retry')} onRetry={page.retry} />
          </Notice>
        ) : (
          <>
            <Breadcrumbs crumbs={name ? [{ label: t('shop.crumbs.home'), href: '/' }, { label: name, href: page.collection?.href ?? '/collections/all/' }] : []} t={t} className={styles.crumbs} />
            <header className={styles.intro}>
              <h1 className={styles.title}>{name ?? t('shop.collection.loading')}</h1>
              {lead ? <p className={styles.lead}>{lead}</p> : null}
            </header>
            <ListingResults listing={page} />
          </>
        )}
      </section>
    </Layout>
  )
}
