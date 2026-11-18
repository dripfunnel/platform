import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { Notice } from '../components/Notice'
import { shop as styles } from '../components/styles/shop'

export const NotFoundPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <section className={styles.page}>
        <Notice main title={t('pages.notFound.title')} lead={t('pages.notFound.lead')}>
          <Link href="/" className={styles.primary}>
            {t('pages.notFound.action')}
          </Link>
          <Link href="/search/" className={styles.secondary}>
            {t('pages.notFound.search')}
          </Link>
        </Notice>
      </section>
    </Layout>
  )
}
