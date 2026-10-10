import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const PolicyPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.policy.title')}>
      <p className={styles.lead}>{t('pages.policy.lead')}</p>
    </Shell>
  )
}
