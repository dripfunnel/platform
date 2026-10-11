import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../../components/Layout'
import { PageIntro } from '../../components/PageIntro'
import styles from '../../styles/page.module.css'

export const AccountPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.account.title')} lead={t('pages.account.lead')}>
        <div className={styles.choices}>
          <Link href="/account/orders/" className={styles.choice}>
            {t('pages.account.orders')}
          </Link>
          <Link href="/account/addresses/" className={styles.choice}>
            {t('pages.account.addresses')}
          </Link>
        </div>
      </PageIntro>
    </Layout>
  )
}
