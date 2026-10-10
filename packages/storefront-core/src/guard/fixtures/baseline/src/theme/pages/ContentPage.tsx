import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const ContentPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.content.title')}>
      <p className={styles.lead}>{t('pages.content.lead')}</p>
    </Shell>
  )
}
