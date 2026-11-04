'use client'

import { Image, Link, useBlog, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { Retry } from './Retry'
import shop from '../../styles/shop.module.css'
import styles from '../../styles/content.module.css'

/** The blog, as D1's Journal: the newest posts as cards, older ones a page at a time; `?tag=` narrows it. */
export const BlogView = () => {
  const { t } = useStorefront()
  const blog = useBlog()
  return (
    <section className={shop.page}>
      <header className={shop.intro}>
        <p className={shop.eyebrow}>{t('pages.blog.eyebrow')}</p>
        <h1 className={shop.title}>{blog.tag ? t('pages.blog.tagged', { tag: blog.tag }) : t('pages.blog.title')}</h1>
        {blog.tag ? (
          <Link href="/blog/" className={shop.textLink}>
            {t('pages.blog.all')}
          </Link>
        ) : null}
      </header>
      {blog.status === 'loading' ? <p className={shop.lead}>{t('pages.blog.loading')}</p> : null}
      {blog.status === 'error' ? (
        <Notice title={t('pages.blog.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={blog.retry} />
        </Notice>
      ) : null}
      {blog.status === 'ready' && blog.posts.length === 0 ? <Notice title={t('pages.blog.empty')} lead={t('pages.blog.emptyLead')} /> : null}
      <div className={styles.posts}>
        {blog.posts.map((p) => (
          <Link key={p.path} href={p.path.replace(/\/?$/, '/')} className={styles.post}>
            {p.cover ? <Image image={p.cover} alt="" ratio={1.5} sizes="(min-width: 900px) 33vw, 100vw" className={styles.cover} /> : <span className={styles.noCover} />}
            {p.published ? <span className={shop.eyebrow}>{p.published}</span> : null}
            <h2 className={styles.postTitle}>{p.title}</h2>
            {p.excerpt ? <p className={styles.excerpt}>{p.excerpt}</p> : null}
          </Link>
        ))}
      </div>
      {blog.loadMoreFailed ? (
        <p className={shop.lead} role="alert">
          {t('pages.blog.olderFailed')}
        </p>
      ) : null}
      {blog.more ? (
        <button type="button" className={shop.secondary} disabled={blog.loadingMore} onClick={() => void blog.loadMore()}>
          {t('pages.blog.older')}
        </button>
      ) : null}
    </section>
  )
}
