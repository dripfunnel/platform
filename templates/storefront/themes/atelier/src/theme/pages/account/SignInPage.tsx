import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../../components/Layout'
import { PageIntro } from '../../components/PageIntro'
import styles from '../../styles/page.module.css'

export const SignInPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.signIn.title')} lead={t('pages.signIn.lead')}>
        <Link href="/register/" className={styles.action}>
          {t('pages.signIn.action')}
        </Link>
      </PageIntro>
    </Layout>
  )
}
