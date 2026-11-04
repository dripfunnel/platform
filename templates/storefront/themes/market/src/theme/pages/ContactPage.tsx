import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { PageIntro } from '../components/PageIntro'
import styles from '../styles/page.module.css'

export const ContactPage = () => {
  const { store, t } = useStorefront()
  const place = [store.address?.street, store.address?.city, store.address?.region, store.address?.postal].filter(Boolean).join(', ')
  return (
    <Layout>
      <PageIntro title={t('pages.contact.title')} lead={t('pages.contact.lead')}>
        <dl className={styles.details}>
          {store.contactEmail ? (
            <div className={styles.detail}>
              <dt className={styles.term}>{t('pages.contact.email')}</dt>
              <dd className={styles.value}>{store.contactEmail}</dd>
            </div>
          ) : null}
          {store.contactPhone ? (
            <div className={styles.detail}>
              <dt className={styles.term}>{t('pages.contact.phone')}</dt>
              <dd className={styles.value}>{store.contactPhone}</dd>
            </div>
          ) : null}
          {place ? (
            <div className={styles.detail}>
              <dt className={styles.term}>{t('pages.contact.visit')}</dt>
              <dd className={styles.value}>{place}</dd>
            </div>
          ) : null}
        </dl>
      </PageIntro>
    </Layout>
  )
}
