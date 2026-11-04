import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { page as styles } from '../components/styles/page'

export const AboutPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <section className={styles.split}>
        <div className={styles.page}>
          <h1 className={styles.title}>{t('pages.about.title')}</h1>
          <p className={styles.lead}>{t('pages.about.first')}</p>
          <p className={styles.lead}>{t('pages.about.second')}</p>
        </div>
        <div className={styles.picture} />
      </section>
    </Layout>
  )
}
