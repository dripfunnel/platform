import { Link, useStorefront, type Listing } from '@dripfunnel/storefront-core/theme'
import { FilterPanel, ListingBar, LoadMore } from './interactive/Filters'
import { Retry } from './interactive/Retry'
import { Notice } from './Notice'
import { GridPlaceholder, ProductGrid } from './ProductCard'

/** A collection's or a search's products: filters, sort, the grid and its states, and "Load more". */
export const ListingResults = ({ listing }: { listing: Listing }) => {
  const { t } = useStorefront()
  return (
    <div className={listing.facets.length ? 'grid gap-y-4 gap-x-4 grid-cols-[minmax(0,1fr)] min-[900px]:gap-y-8 min-[900px]:gap-x-8 min-[900px]:grid-cols-[220px_minmax(0,1fr)]' : 'group/shop-listing grid gap-y-4 gap-x-4 grid-cols-[minmax(0,1fr)]'}>
      <FilterPanel listing={listing} />
      <div className="flex min-w-0 flex-col gap-y-3.5 gap-x-3.5">
        {listing.status === 'ready' ? (
          <ListingBar listing={listing} />
        ) : null}
        {listing.status === 'loading' ? <GridPlaceholder label={t('shop.listing.loading')} count={6} /> : null}
        {listing.status === 'error' ? (
          <Notice title={t('shop.listing.failed')} lead={t('shop.listing.failedLead')}>
            <Retry label={t('shop.listing.retry')} onRetry={listing.retry} />
          </Notice>
        ) : null}
        {listing.status === 'ready' && listing.items.length === 0 ? (
          listing.selected.length ? (
            <Notice title={t('shop.listing.empty')} lead={t('shop.listing.emptyLead')}>
              <Retry label={t('shop.listing.clear')} onRetry={listing.clear} />
            </Notice>
          ) : (
            <Notice title={t('shop.collection.empty')} lead={t('shop.collection.emptyLead')}>
              <Link href="/" className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
                {t('shop.collection.home')}
              </Link>
            </Notice>
          )
        ) : null}
        {listing.status === 'ready' ? <ProductGrid products={listing.items} /> : null}
        <LoadMore listing={listing} />
      </div>
    </div>
  )
}
