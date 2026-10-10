import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'
import { Disclosure } from '../components/interactive/Disclosure'

export const HomePage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.home.title')}>
      <p className={styles.lead}>{t('pages.home.lead')}</p>
      <Disclosure label={t('pages.home.more')}>
        <p className={styles.body}>{t('pages.home.story')}</p>
      </Disclosure>
    </Shell>
  )
}
