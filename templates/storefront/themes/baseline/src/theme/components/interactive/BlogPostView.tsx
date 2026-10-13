'use client'

import { Image, Link, useBlogPost, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { ContentBlocks } from './ContentBlocks'
import { Retry } from './Retry'
import shop from '../../styles/shop.module.css'
import styles from '../../styles/content.module.css'

/** A post, as D1's Journal post: back to the journal, its date and author, title, cover, blocks and tags. */
export const BlogPostView = () => {
  const { t } = useStorefront()
  const view = useBlogPost()
  if (view.status === 'loading') {
    return (
      <section className={shop.page} aria-busy="true">
        <h1 className={shop.title}>{t('pages.blog.loadingPost')}</h1>
      </section>
    )
  }
  if (view.status === 'error') {
    return (
      <section className={shop.page}>
        <Notice main title={t('pages.blog.failedPost')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={view.retry} />
        </Notice>
      </section>
    )
  }
  const post = view.post
  if (!post) {
    return (
      <section className={shop.page}>
        <Notice main title={t('pages.notFound.title')} lead={t('pages.notFound.lead')}>
          <Link href="/blog/" className={shop.primary}>
            {t('pages.blog.back')}
          </Link>
        </Notice>
      </section>
    )
  }
  const meta = [post.published, post.author ? t('pages.blog.by', { author: post.author }) : null].filter(Boolean).join(' · ')
  return (
    <article className={styles.article}>
      <Link href="/blog/" className={styles.back}>
        {t('pages.blog.back')}
      </Link>
      {meta ? <p className={shop.eyebrow}>{meta}</p> : null}
      <h1 className={styles.title}>{post.title}</h1>
      {post.cover ? <Image image={post.cover} alt="" ratio={1.78} sizes="(min-width: 900px) 720px, 100vw" className={styles.image} /> : null}
      <ContentBlocks blocks={post.body} />
      {post.tags.length > 0 ? (
        <nav className={shop.chips} aria-label={t('pages.blog.tags')}>
          {post.tags.map((tag) => (
            <Link key={tag.name} href={tag.href} className={shop.chipLink}>
              {tag.name}
            </Link>
          ))}
        </nav>
      ) : null}
    </article>
  )
}
