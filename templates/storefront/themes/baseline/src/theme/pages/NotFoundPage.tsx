import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { Notice } from '../components/Notice'

export const NotFoundPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <Notice main title={t('pages.notFound.title')} lead={t('pages.notFound.lead')}>
          <Link href="/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
            {t('pages.notFound.action')}
          </Link>
          <Link href="/search/" className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
            {t('pages.notFound.search')}
          </Link>
        </Notice>
      </section>
    </Layout>
  )
}
