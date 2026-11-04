import { Breadcrumbs, Link, useCollection, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { ListingResults } from '../components/ListingResults'
import { Notice } from '../components/Notice'
import { Retry } from '../components/interactive/Retry'

export const CollectionPage = () => {
  const { t } = useStorefront()
  const page = useCollection()
  const name = page.collection?.name ?? (page.all ? t('shop.collection.all') : null)
  const lead = page.collection ? page.collection.description : page.all ? t('shop.collection.allLead') : null
  return (
    <Layout>
      <section className="pt-5 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col gap-y-4 gap-x-4 mx-auto min-[900px]:pt-6 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
        {page.found === 'missing' ? (
          <Notice main title={t('shop.collection.missing')} lead={t('shop.collection.missingLead')}>
            <Link href="/collections/all/" className="py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center self-start rounded-button bg-accent text-accent-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
              {t('shop.collection.browse')}
            </Link>
          </Notice>
        ) : page.found === 'error' ? (
          <Notice main title={t('shop.listing.failed')} lead={t('shop.listing.failedLead')}>
            <Retry label={t('shop.listing.retry')} onRetry={page.retry} />
          </Notice>
        ) : (
          <>
            <Breadcrumbs crumbs={name ? [{ label: t('shop.crumbs.home'), href: '/' }, { label: name, href: page.collection?.href ?? '/collections/all/' }] : []} t={t} className="block text-[13px] [--df-sealed-size:13px] [--df-sealed-color:var(--color-muted)] [&::part(link)]:text-ink-soft" />
            <header className="flex flex-col gap-y-1.5 gap-x-1.5">
              <h1 className="m-0 max-w-[24ch] font-heading text-[30px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[36px]">{name ?? t('shop.collection.loading')}</h1>
              {lead ? <p className="m-0 max-w-[60ch] text-muted text-[15px] wrap-anywhere">{lead}</p> : null}
            </header>
            <ListingResults listing={page} />
          </>
        )}
      </section>
    </Layout>
  )
}
