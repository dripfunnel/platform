import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../../components/Shell'
import styles from '../../styles/page.module.css'

export const AccessPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.access.title')}>
      <p className={styles.lead}>{t('pages.access.lead')}</p>
    </Shell>
  )
}
