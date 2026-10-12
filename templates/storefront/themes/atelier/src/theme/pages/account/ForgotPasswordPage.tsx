import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../../components/Layout'
import { PageIntro } from '../../components/PageIntro'
import styles from '../../styles/page.module.css'

export const ForgotPasswordPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.forgotPassword.title')} lead={t('pages.forgotPassword.lead')}>
        <Link href="/sign-in/" className={styles.action}>
          {t('pages.forgotPassword.action')}
        </Link>
      </PageIntro>
    </Layout>
  )
}
