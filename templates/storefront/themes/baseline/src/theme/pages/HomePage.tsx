import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import styles from '../styles/home.module.css'

export const HomePage = () => {
  const { store, t } = useStorefront()
  return (
    <Layout>
      <section className={styles.hero}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>{t('home.hero.eyebrow')}</p>
          <h1 className={styles.title}>{t('home.hero.title', { store: store.name })}</h1>
          <p className={styles.lead}>{store.description ?? t('home.hero.lead')}</p>
          <div className={styles.actions}>
            <Link href="/search/" className={styles.button}>
              {t('home.hero.shop')}
            </Link>
            <Link href="/about/" className={styles.ghost}>
              {t('home.hero.story')}
            </Link>
          </div>
        </div>
        <div className={styles.picture} />
      </section>
      <section className={styles.story}>
        <div className={styles.storyPicture} />
        <div className={styles.storyCopy}>
          <p className={styles.eyebrow}>{t('home.story.eyebrow')}</p>
          <h2 className={styles.heading}>{t('home.story.title')}</h2>
          <p className={styles.body}>{t('home.story.body')}</p>
          <Link href="/about/" className={styles.ghost}>
            {t('home.story.more')}
          </Link>
        </div>
      </section>
      <section className={styles.signup}>
        <h2 className={styles.heading}>{t('home.signup.title')}</h2>
        <p className={styles.body}>{t('home.signup.body')}</p>
        <Link href="/register/" className={styles.button}>
          {t('home.signup.action')}
        </Link>
      </section>
    </Layout>
  )
}
