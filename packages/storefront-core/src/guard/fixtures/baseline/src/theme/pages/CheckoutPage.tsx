import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const CheckoutPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.checkout.title')}>
      <p className={styles.lead}>{t('pages.checkout.lead')}</p>
    </Shell>
  )
}
