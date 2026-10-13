'use client'

import { Link, useContentPage, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { ContentBlocks } from './ContentBlocks'
import { Retry } from './Retry'
import shop from '../../styles/shop.module.css'
import styles from '../../styles/content.module.css'

/** A content page (FAQ, lookbook, the merchant's own), as D1's FAQ page lays one out: its title, then its blocks. */
export const ContentView = () => {
  const { t } = useStorefront()
  const view = useContentPage()
  if (view.status === 'loading') {
    return (
      <section className={shop.page} aria-busy="true">
        <h1 className={shop.title}>{t('pages.content.loading')}</h1>
      </section>
    )
  }
  if (view.status === 'error') {
    return (
      <section className={shop.page}>
        <Notice main title={t('pages.content.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={view.retry} />
        </Notice>
      </section>
    )
  }
  if (!view.page) {
    return (
      <section className={shop.page}>
        <Notice main title={t('pages.notFound.title')} lead={t('pages.notFound.lead')}>
          <Link href="/" className={shop.primary}>
            {t('pages.notFound.action')}
          </Link>
        </Notice>
      </section>
    )
  }
  return (
    <article className={styles.article}>
      <h1 className={styles.title}>{view.page.title}</h1>
      <ContentBlocks blocks={view.page.body} />
    </article>
  )
}
