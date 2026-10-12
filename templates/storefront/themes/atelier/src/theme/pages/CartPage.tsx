import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { PageIntro } from '../components/PageIntro'
import styles from '../styles/page.module.css'

export const CartPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.cart.title')} lead={t('pages.cart.lead')}>
        <Link href="/search/" className={styles.action}>
          {t('pages.cart.action')}
        </Link>
      </PageIntro>
    </Layout>
  )
}
