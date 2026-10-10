import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const CollectionPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.collection.title')}>
      <p className={styles.lead}>{t('pages.collection.lead')}</p>
    </Shell>
  )
}
