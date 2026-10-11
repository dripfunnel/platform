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
      </section>
      <section className={styles.banner}>
        <h2 className={styles.heading}>{t('home.banner.title')}</h2>
        <p className={styles.body}>{t('home.banner.body')}</p>
        <Link href="/register/" className={styles.bannerButton}>
          {t('home.banner.action')}
        </Link>
      </section>
    </Layout>
  )
}
