import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import about from '../styles/about.module.css'
import policy from '../styles/policy.module.css'
import styles from '../styles/page.module.css'

export const ContactPage = () => {
  const { store, t } = useStorefront()
  const place = [store.address?.street, store.address?.city, store.address?.region, store.address?.postal].filter(Boolean).join(', ')
  return (
    <Layout>
      <header className={policy.band}>
        <h1 className={policy.title}>{t('pages.contact.title')}</h1>
        <span className={policy.rule} />
        <p className={styles.lead}>{t('pages.contact.lead')}</p>
      </header>
      <section className={about.visit}>
        <div className={about.visitCard}>
          <div className={about.visitPanel}>
            <span className={about.visitIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 10h16M5 10l1-5h12l1 5M5 10v10h14V10M9 20v-5h6v5" />
              </svg>
            </span>
            <h2 className={about.visitTitle}>{t('pages.about.visit.title')}</h2>
            <p className={about.visitLead}>{t('pages.about.visit.lead')}</p>
          </div>
          <div className={about.visitDetails}>
            <p className={about.visitName}>{store.name}</p>
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
          </div>
        </div>
      </section>
    </Layout>
  )
}
