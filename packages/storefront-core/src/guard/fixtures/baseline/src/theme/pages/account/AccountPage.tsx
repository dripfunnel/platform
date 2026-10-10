import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../../components/Shell'
import styles from '../../styles/page.module.css'

export const AccountPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.account.title')}>
      <p className={styles.lead}>{t('pages.account.lead')}</p>
    </Shell>
  )
}
