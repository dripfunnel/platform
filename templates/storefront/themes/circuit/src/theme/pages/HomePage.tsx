import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import styles from '../styles/home.module.css'

export const HomePage = () => {
  const { store, t } = useStorefront()
  return (
    <Layout>
      <section className={styles.hero}>
        <div className={styles.copy}>
          <h1 className={styles.title}>{t('home.hero.title', { store: store.name })}</h1>
          <p className={styles.lead}>{store.description ?? t('home.hero.lead')}</p>
          <Link href="/search/" className={styles.button}>
            {t('home.hero.shop')}
          </Link>
        </div>
        <div className={styles.picture} />
      </section>
      <section className={styles.features}>
        <h2 className={styles.heading}>{t('home.features.title')}</h2>
        <div className={styles.featureGrid}>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>{t('home.features.one.title')}</h3>
            <p className={styles.featureBody}>{t('home.features.one.body')}</p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>{t('home.features.two.title')}</h3>
            <p className={styles.featureBody}>{t('home.features.two.body')}</p>
          </div>
          <div className={styles.feature}>
            <h3 className={styles.featureTitle}>{t('home.features.three.title')}</h3>
            <p className={styles.featureBody}>{t('home.features.three.body')}</p>
          </div>
        </div>
      </section>
      <section className={styles.join}>
        <h2 className={styles.heading}>{t('home.join.title')}</h2>
        <p className={styles.body}>{t('home.join.body')}</p>
        <Link href="/register/" className={styles.button}>
          {t('home.join.action')}
        </Link>
      </section>
    </Layout>
  )
}
