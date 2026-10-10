import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const AboutPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.about.title')}>
      <p className={styles.lead}>{t('pages.about.lead')}</p>
    </Shell>
  )
}
