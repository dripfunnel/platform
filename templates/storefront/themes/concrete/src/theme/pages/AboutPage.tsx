import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import styles from '../styles/page.module.css'

export const AboutPage = () => {
  const { store, t } = useStorefront()
  return (
    <Layout>
      <section className={styles.split}>
        <div className={styles.page}>
          <h1 className={styles.title}>{t('pages.about.title')}</h1>
          <p className={styles.lead}>{t('pages.about.first', { store: store.name })}</p>
          <p className={styles.lead}>{t('pages.about.second', { store: store.name })}</p>
        </div>
        <div className={styles.picture} />
      </section>
    </Layout>
  )
}
