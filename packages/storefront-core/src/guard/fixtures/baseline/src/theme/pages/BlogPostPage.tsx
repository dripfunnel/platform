import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Shell } from '../components/Shell'
import styles from '../styles/page.module.css'

export const BlogPostPage = () => {
  const { t } = useStorefront()
  return (
    <Shell title={t('pages.blogPost.title')}>
      <p className={styles.lead}>{t('pages.blogPost.lead')}</p>
    </Shell>
  )
}
