import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const ProductPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.product.title')}>
      <p className={styles.lead}>{t('pages.product.lead')}</p>
    </Shell>
  )
}
