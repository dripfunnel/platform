import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { PageIntro } from '../components/PageIntro'
import styles from '../styles/page.module.css'

export const NotFoundPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.notFound.title')} lead={t('pages.notFound.lead')}>
        <Link href="/" className={styles.action}>
          {t('pages.notFound.action')}
        </Link>
      </PageIntro>
    </Layout>
  )
}
