'use client'

import { Image, Link, useBlogPost, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { ContentBlocks } from './ContentBlocks'
import { Retry } from './Retry'

/** A post, as D1's Journal post: back to the journal, its date and author, title, cover, blocks and tags. */
export const BlogPostView = () => {
  const { t } = useStorefront()
  const view = useBlogPost()
  if (view.status === 'loading') {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8" aria-busy="true">
        <h1 className="m-0 max-w-[24ch] font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[36px]">{t('pages.blog.loadingPost')}</h1>
      </section>
    )
  }
  if (view.status === 'error') {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('pages.blog.failedPost')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={view.retry} />
        </Notice>
      </section>
    )
  }
  const post = view.post
  if (!post) {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('pages.notFound.title')} lead={t('pages.notFound.lead')}>
          <Link href="/blog/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
            {t('pages.blog.back')}
          </Link>
        </Notice>
      </section>
    )
  }
  const meta = [post.published, post.author ? t('pages.blog.by', { author: post.author }) : null].filter(Boolean).join(' · ')
  return (
    <article className="pt-6 pr-4 pb-2 pl-4 flex box-border w-[min(100%,760px)] flex-col gap-y-4 gap-x-4 mx-auto">
      <Link href="/blog/" className="self-start text-ink-soft text-[14px]">
        {t('pages.blog.back')}
      </Link>
      {meta ? <p className="m-0 text-muted text-[12px] tracking-[0.12em] uppercase">{meta}</p> : null}
      <h1 className="m-0 font-heading text-[34px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] [text-transform:var(--heading-case)] min-[1000px]:text-[40px]">{post.title}</h1>
      {post.cover ? <Image image={post.cover} alt="" ratio={1.78} sizes="(min-width: 900px) 720px, 100vw" className="w-full h-auto rounded-card" /> : null}
      <ContentBlocks blocks={post.body} />
      {post.tags.length > 0 ? (
        <nav className="flex flex-wrap gap-y-2 gap-x-2 group-[:nth-child(n)]/shop-toolbar:basis-[100%] group-[:nth-child(n)]/shop-toolbar:empty:hidden" aria-label={t('pages.blog.tags')}>
          {post.tags.map((tag) => (
            <Link key={tag.name} href={tag.href} className="py-0 px-3.5 border border-line inline-flex min-h-9 items-center gap-y-1.5 gap-x-1.5 rounded-button bg-surface text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[13px] no-underline cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
              {tag.name}
            </Link>
          ))}
        </nav>
      ) : null}
    </article>
  )
}
