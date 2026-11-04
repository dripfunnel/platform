import { Link, SearchField, useCollections, useSearch, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { ListingResults } from '../components/ListingResults'
import { Notice } from '../components/Notice'

export const SearchPage = () => {
  const { t } = useStorefront()
  const search = useSearch()
  const { collections } = useCollections({ first: 6 })
  const none = search.status === 'ready' && search.items.length === 0 && search.selected.length === 0
  return (
    <Layout>
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        <header className="flex flex-col gap-y-1.5 gap-x-1.5">
          <h1 className="m-0 max-w-[24ch] font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[36px]">{search.query ? t('shop.search.results', { query: search.query }) : t('shop.search.title')}</h1>
          {search.query ? null : <p className="m-0 max-w-[60ch] text-muted text-[15px] wrap-anywhere">{t('shop.search.lead')}</p>}
        </header>
        <SearchField label={t('shop.search.label')} placeholder={t('shop.search.placeholder')} button={t('shop.search.button')} value={search.query} onSearch={search.setQuery} suggest={4} className={'relative flex w-full max-w-[640px] flex-wrap gap-y-2 gap-x-2 [&_ul]:p-1.5 [&_ul]:m-0 [&_ul]:border [&_ul]:border-line [&_ul]:absolute [&_ul]:z-20 [&_ul]:top-[calc(100%_+_6px)] [&_ul]:right-0 [&_ul]:left-0 [&_ul]:rounded-card [&_ul]:bg-surface [&_ul]:[box-shadow:0_12px_32px_color-mix(in_srgb,var(--color-ink)_12%,transparent)] [&_ul]:list-none [&_li]:rounded-[8px] [&_li]:cursor-pointer [&_li:hover]:bg-soft [&_li[aria-selected="true"]]:bg-soft [&_li:last-child]:py-2.5 [&_li:last-child]:px-2 [&_li:last-child]:text-accent [&_li:last-child]:font-semibold [&_li_a]:p-2 [&_li_a]:flex [&_li_a]:items-center [&_li_a]:gap-y-3 [&_li_a]:gap-x-3 [&_li_a]:text-ink [&_li_a]:no-underline [&_li_img]:w-12 [&_li_img]:h-12 [&_li_img]:shrink-0 [&_li_img]:rounded-[6px] [&_li_img]:object-cover [&_li_span]:flex-1 [&_p]:m-0 [&_p]:w-full [&_p]:text-muted [&_p]:text-[14px] [&_p:empty]:hidden [&_label]:absolute [&_label]:overflow-hidden [&_label]:w-px [&_label]:h-px [&_label]:[clip-path:inset(50%)] [&_label]:whitespace-nowrap [&_input]:py-0 [&_input]:px-4 [&_input]:border [&_input]:border-line [&_input]:min-w-0 [&_input]:min-h-12 [&_input]:flex-1 [&_input]:rounded-button [&_input]:bg-surface [&_input]:text-ink [&_input]:[font-family:inherit] [&_input]:[font-size:inherit] [&_input]:[font-weight:inherit] [&_input]:[font-style:inherit] [&_input]:[line-height:inherit] [&_button]:py-0 [&_button]:px-5.5 [&_button]:border [&_button]:border-accent [&_button]:min-h-12 [&_button]:rounded-button [&_button]:bg-accent [&_button]:text-accent-ink [&_button]:[font-family:inherit] [&_button]:[font-size:inherit] [&_button]:[font-style:inherit] [&_button]:[line-height:inherit] [&_button]:font-semibold [&_button]:cursor-pointer [&_input:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_input:focus-visible]:outline-offset-[2px] [&_button:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_button:focus-visible]:outline-offset-[2px]'} />
        {none ? (
          <Notice title={t('shop.search.none', { query: search.query })} lead={t('shop.search.noneLead')}>
            {collections.map((c) => (
              <Link key={c.id} href={c.href} className="py-0 px-3.5 border border-line inline-flex min-h-9 items-center gap-y-1.5 gap-x-1.5 rounded-button bg-surface text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[13px] no-underline cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
                {c.name}
              </Link>
            ))}
          </Notice>
        ) : search.status === 'idle' ? null : (
          <ListingResults listing={search} />
        )}
      </section>
    </Layout>
  )
}
