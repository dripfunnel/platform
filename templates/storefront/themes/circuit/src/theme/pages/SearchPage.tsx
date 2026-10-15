import { Link, SearchField, useCollections, useSearch, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { ListingResults } from '../components/ListingResults'
import { Notice } from '../components/Notice'
import styles from '../styles/shop.module.css'

export const SearchPage = () => {
  const { t } = useStorefront()
  const search = useSearch()
  const { collections } = useCollections({ first: 6 })
  const none = search.status === 'ready' && search.items.length === 0 && search.selected.length === 0
  return (
    <Layout>
      <section className={styles.page}>
        <header className={styles.intro}>
          <h1 className={styles.title}>{search.query ? t('shop.search.results', { query: search.query }) : t('shop.search.title')}</h1>
          {search.query ? null : <p className={styles.lead}>{t('shop.search.lead')}</p>}
        </header>
        <SearchField label={t('shop.search.label')} placeholder={t('shop.search.placeholder')} button={t('shop.search.button')} value={search.query} onSearch={search.setQuery} className={styles.search} />
        {none ? (
          <Notice title={t('shop.search.none', { query: search.query })} lead={t('shop.search.noneLead')}>
            {collections.map((c) => (
              <Link key={c.id} href={c.href} className={styles.chipLink}>
                {c.name}
              </Link>
            ))}
          </Notice>
        ) : search.status === 'idle' ? null : (
          <ListingResults listing={search} />
        )}
      </section>
    </Layout>
  )
}
