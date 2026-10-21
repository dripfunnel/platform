import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const CartPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.cart.title')}>
      <p className={styles.lead}>{t('pages.cart.lead')}</p>
    </Shell>
  )
}
