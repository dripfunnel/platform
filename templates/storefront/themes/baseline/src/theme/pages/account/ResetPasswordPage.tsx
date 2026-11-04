import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../../components/Layout'
import { PageIntro } from '../../components/PageIntro'
import { page as styles } from '../../components/styles/page'

export const ResetPasswordPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.resetPassword.title')} lead={t('pages.resetPassword.lead')}>
        <Link href="/sign-in/" className={styles.action}>
          {t('pages.resetPassword.action')}
        </Link>
      </PageIntro>
    </Layout>
  )
}
