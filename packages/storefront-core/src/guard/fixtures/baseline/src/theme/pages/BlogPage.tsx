import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const BlogPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.blog.title')}>
      <p className={styles.lead}>{t('pages.blog.lead')}</p>
    </Shell>
  )
}
