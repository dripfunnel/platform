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
            <p className={styles.lead}>{t('home.hero.lead')}</p>
            <Link href="/search/" className={styles.button}>
              {t('home.hero.shop')}
            </Link>
        </div>
        <div className={styles.picture} />
      </section>
      <section className={styles.storyCentered}>
        <h2 className={styles.heading}>{t('home.story.title')}</h2>
        <p className={styles.body}>{t('home.story.body')}</p>
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
