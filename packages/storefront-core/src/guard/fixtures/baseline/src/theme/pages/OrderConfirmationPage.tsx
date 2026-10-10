import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const OrderConfirmationPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.confirmation.title')}>
      <p className={styles.lead}>{t('pages.confirmation.lead')}</p>
    </Shell>
  )
}
