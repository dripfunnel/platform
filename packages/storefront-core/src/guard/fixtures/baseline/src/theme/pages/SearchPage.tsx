import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const SearchPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.search.title')}>
      <p className={styles.lead}>{t('pages.search.lead')}</p>
    </Shell>
  )
}
