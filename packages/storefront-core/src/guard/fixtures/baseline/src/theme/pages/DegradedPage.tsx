import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const DegradedPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.degraded.title')}>
      <p className={styles.lead}>{t('pages.degraded.lead')}</p>
    </Shell>
  )
}
