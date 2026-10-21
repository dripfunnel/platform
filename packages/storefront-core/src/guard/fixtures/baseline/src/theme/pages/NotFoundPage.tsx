import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const NotFoundPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.notFound.title')}>
      <p className={styles.lead}>{t('pages.notFound.lead')}</p>
    </Shell>
  )
}
