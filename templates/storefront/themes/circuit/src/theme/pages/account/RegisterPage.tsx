import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../../components/Layout'
import { PageIntro } from '../../components/PageIntro'
import styles from '../../styles/page.module.css'

export const RegisterPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.register.title')} lead={t('pages.register.lead')}>
        <Link href="/sign-in/" className={styles.action}>
          {t('pages.register.action')}
        </Link>
      </PageIntro>
    </Layout>
  )
}
