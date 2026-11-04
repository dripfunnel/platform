'use client'

import { Image, Link, useBlog, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { Retry } from './Retry'

/** The blog, as D1's Journal: the newest posts as cards, older ones a page at a time; `?tag=` narrows it. */
export const BlogView = () => {
  const { t } = useStorefront()
  const blog = useBlog()
  return (
    <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
      <header className="flex flex-col gap-y-1.5 gap-x-1.5">
        <p className="m-0 text-muted text-[12px] tracking-[0.12em] uppercase">{t('pages.blog.eyebrow')}</p>
        <h1 className="m-0 max-w-[24ch] font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[36px]">{blog.tag ? t('pages.blog.tagged', { tag: blog.tag }) : t('pages.blog.title')}</h1>
        {blog.tag ? (
          <Link href="/blog/" className="text-ink text-[14px] underline-offset-[3px] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
            {t('pages.blog.all')}
          </Link>
        ) : null}
      </header>
      {blog.status === 'loading' ? <p className="m-0 max-w-[60ch] text-muted text-[15px] wrap-anywhere">{t('pages.blog.loading')}</p> : null}
      {blog.status === 'error' ? (
        <Notice title={t('pages.blog.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={blog.retry} />
        </Notice>
      ) : null}
      {blog.status === 'ready' && blog.posts.length === 0 ? <Notice title={t('pages.blog.empty')} lead={t('pages.blog.emptyLead')} /> : null}
      <div className="grid gap-y-6 gap-x-6 min-[700px]:grid-cols-[repeat(2,minmax(0,1fr))] min-[1000px]:grid-cols-[repeat(3,minmax(0,1fr))]">
        {blog.posts.map((p) => (
          <Link key={p.path} href={p.path.replace(/\/?$/, '/')} className="focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] flex flex-col gap-y-2 gap-x-2 text-ink no-underline">
            {p.cover ? <Image image={p.cover} alt="" ratio={1.5} sizes="(min-width: 900px) 33vw, 100vw" className="w-full h-auto rounded-card" /> : <span className="aspect-[3/2] rounded-card [background:var(--picture)]" />}
            {p.published ? <span className="m-0 text-muted text-[12px] tracking-[0.12em] uppercase">{p.published}</span> : null}
            <h2 className="m-0 font-heading text-[22px] font-[var(--heading-weight)]">{p.title}</h2>
            {p.excerpt ? <p className="m-0 text-muted text-[15px]">{p.excerpt}</p> : null}
          </Link>
        ))}
      </div>
      {blog.loadMoreFailed ? (
        <p className="m-0 max-w-[60ch] text-muted text-[15px] wrap-anywhere" role="alert">
          {t('pages.blog.olderFailed')}
        </p>
      ) : null}
      {blog.more ? (
        <button type="button" className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" disabled={blog.loadingMore} onClick={() => void blog.loadMore()}>
          {t('pages.blog.older')}
        </button>
      ) : null}
    </section>
  )
}
