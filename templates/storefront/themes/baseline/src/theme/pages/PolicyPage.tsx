import { Link, useLocation, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'

const kinds = ['terms', 'privacy', 'shipping', 'returns', 'legal'] as const
type Kind = (typeof kinds)[number]

// The Shop API serves no policy text yet, so the page names the policy and how to ask about it (card #307).
export const PolicyPage = () => {
  const { t } = useStorefront()
  const { path } = useLocation()
  const kind = kinds.find((k) => path === `/policies/${k}/` || path === `/policies/${k}`)
  const names: Record<Kind, string> = { terms: t('pages.policy.terms'), privacy: t('pages.policy.privacy'), shipping: t('pages.policy.shipping'), returns: t('pages.policy.returns'), legal: t('pages.policy.legal') }
  return (
    <Layout>
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <header className="flex flex-col gap-y-1.5 gap-x-1.5">
          <p className="m-0 text-muted text-[12px] tracking-[0.12em] uppercase">{t('pages.policy.eyebrow')}</p>
          <h1 className="m-0 max-w-[24ch] font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[36px]">{kind ? names[kind] : t('pages.policy.title')}</h1>
          <p className="m-0 max-w-[60ch] text-muted text-[15px] wrap-anywhere">{kind ? t('pages.policy.ask') : t('pages.policy.lead')}</p>
        </header>
        <Link href="/contact/" className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
          {t('pages.contact.title')}
        </Link>
        <nav className="flex flex-wrap gap-y-2 gap-x-2 group-[:nth-child(n)]/shop-toolbar:basis-[100%] group-[:nth-child(n)]/shop-toolbar:empty:hidden" aria-label={t('pages.policy.eyebrow')}>
          {kinds.map((k) =>
            k === kind ? (
              <span key={k} className="py-0 px-3.5 border border-ink inline-flex min-h-9 items-center gap-y-1.5 gap-x-1.5 rounded-button [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[13px] no-underline cursor-pointer bg-ink text-bg focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" aria-current="page">
                {names[k]}
              </span>
            ) : (
              <Link key={k} href={`/policies/${k}/`} className="py-0 px-3.5 border border-line inline-flex min-h-9 items-center gap-y-1.5 gap-x-1.5 rounded-button bg-surface text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[13px] no-underline cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
                {names[k]}
              </Link>
            ),
          )}
        </nav>
      </section>
    </Layout>
  )
}
