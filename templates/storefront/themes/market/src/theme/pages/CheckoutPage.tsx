import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { PageIntro } from '../components/PageIntro'
import styles from '../styles/page.module.css'

export const CheckoutPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.checkout.title')} lead={t('pages.checkout.lead')}>
        <Link href="/cart/" className={styles.action}>
          {t('pages.checkout.action')}
        </Link>
      </PageIntro>
    </Layout>
  )
}
