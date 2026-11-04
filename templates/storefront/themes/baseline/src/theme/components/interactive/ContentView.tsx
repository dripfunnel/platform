'use client'

import { Link, useContentPage, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Notice } from '../Notice'
import { ContentBlocks } from './ContentBlocks'
import { Retry } from './Retry'

/** A content page (FAQ, lookbook, the merchant's own), as D1's FAQ page lays one out: its title, then its blocks. */
export const ContentView = () => {
  const { t } = useStorefront()
  const view = useContentPage()
  if (view.status === 'loading') {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8" aria-busy="true">
        <h1 className="m-0 max-w-[24ch] font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[36px]">{t('pages.content.loading')}</h1>
      </section>
    )
  }
  if (view.status === 'error') {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('pages.content.failed')} lead={t('shop.listing.failedLead')}>
          <Retry label={t('shop.listing.retry')} onRetry={view.retry} />
        </Notice>
      </section>
    )
  }
  if (!view.page) {
    return (
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('pages.notFound.title')} lead={t('pages.notFound.lead')}>
          <Link href="/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
            {t('pages.notFound.action')}
          </Link>
        </Notice>
      </section>
    )
  }
  return (
    <article className="pt-6 pr-4 pb-2 pl-4 flex box-border w-[min(100%,760px)] flex-col gap-y-4 gap-x-4 mx-auto">
      <h1 className="m-0 font-heading text-[34px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] [text-transform:var(--heading-case)] min-[1000px]:text-[40px]">{view.page.title}</h1>
      <ContentBlocks blocks={view.page.body} />
    </article>
  )
}
