'use client'

import { useState } from 'react'
import { Checkbox, Select, useStorefront, type Listing, type SortKey } from '@dripfunnel/storefront-core/theme'

/** The filter values, a sidebar on wide screens and a panel the Filters button opens on narrow ones. */
export const FilterPanel = ({ listing }: { listing: Listing }) => {
  const { t } = useStorefront()
  const [open, setOpen] = useState(false)
  if (listing.facets.length === 0) return null
  return (
    <aside className="flex min-w-0 flex-col gap-y-3 gap-x-3">
      <button type="button" className="py-0 px-4.5 border border-line inline-flex min-h-11 self-start items-center gap-y-2 gap-x-2 rounded-button bg-surface text-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] min-[900px]:hidden" aria-expanded={open} aria-controls="listing-filters" onClick={() => setOpen(!open)}>
        {open ? t('shop.listing.filtersShown') : t('shop.listing.filters')}
        {listing.selected.length ? <span className="inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-ink text-bg text-[12px]">{listing.selected.length}</span> : null}
      </button>
      <div id="listing-filters" className={open ? 'flex flex-col min-[900px]:flex min-[900px]:flex-col' : 'hidden min-[900px]:flex min-[900px]:flex-col'}>
        {listing.facets.map((facet) => (
          <div key={facet.id} role="group" aria-label={facet.name} className="py-3 px-0 border-b border-b-line flex flex-col gap-y-0.5 gap-x-0.5">
            <p className="mt-0 mr-0 mb-1 ml-0 text-[14px] font-semibold">{facet.name}</p>
            {facet.values.map((value) => (
              <Checkbox key={value.id} checked={value.selected} onChange={() => listing.toggle(value.id)} className="flex min-h-8 items-center gap-y-2 gap-x-2 text-ink-soft text-[14px] cursor-pointer [&_input]:m-0 [&_input]:w-4.5 [&_input]:h-4.5 [&_input]:[accent-color:var(--color-accent)] [&_input:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_input:focus-visible]:outline-offset-[2px]">
                {value.name} <span className="m-0 text-muted text-[14px]">({value.count})</span>
              </Checkbox>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}

/** How many products show, the sort, and the chosen filters as chips that each remove one. */
export const ListingBar = ({ listing }: { listing: Listing }) => {
  const { t } = useStorefront()
  const labels: Record<SortKey, string> = {
    featured: t('shop.listing.sorts.featured'),
    newest: t('shop.listing.sorts.newest'),
    'price-low': t('shop.listing.sorts.priceLow'),
    'price-high': t('shop.listing.sorts.priceHigh'),
    name: t('shop.listing.sorts.name'),
  }
  return (
    <div className="group/shop-toolbar flex flex-wrap items-center justify-between gap-y-2.5 gap-x-2.5">
      <p className="m-0 text-muted text-[14px]" role="status">
        {t('shop.listing.showing', { count: listing.items.length })}
      </p>
      <Select label={t('shop.listing.sort')} value={listing.sort} options={listing.sorts.map((s) => ({ value: s, label: labels[s] }))} onChange={listing.setSort} className="ml-auto inline-flex items-center gap-y-2.5 gap-x-2.5 text-muted text-[14px] [&_select]:py-0 [&_select]:px-3.5 [&_select]:border [&_select]:border-line [&_select]:min-h-11 [&_select]:rounded-button [&_select]:bg-surface [&_select]:text-ink [&_select]:[font-family:inherit] [&_select]:[font-size:inherit] [&_select]:[font-weight:inherit] [&_select]:[font-style:inherit] [&_select]:[line-height:inherit] [&_select:focus-visible]:[outline:2px_solid_var(--color-focus)] [&_select:focus-visible]:outline-offset-[2px]" />
      <div className="flex flex-wrap gap-y-2 gap-x-2 group-[:nth-child(n)]/shop-toolbar:basis-[100%] group-[:nth-child(n)]/shop-toolbar:empty:hidden">
        {listing.selected.map((s) => (
          <button key={s.id} type="button" className="py-0 px-3.5 border border-line inline-flex min-h-9 items-center gap-y-1.5 gap-x-1.5 rounded-button bg-surface text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[13px] no-underline cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" aria-label={t('shop.listing.remove', { name: s.name })} onClick={() => listing.toggle(s.id)}>
            {s.name}
            <svg className="w-3 h-3 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-width:1.8]" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        ))}
        {listing.selected.length > 1 ? (
          <button type="button" className="py-0 px-3.5 border border-transparent inline-flex min-h-9 items-center gap-y-1.5 gap-x-1.5 rounded-button text-ink [font-family:inherit] [font-weight:inherit] [font-style:inherit] [line-height:inherit] text-[13px] cursor-pointer bg-transparent underline focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" onClick={listing.clear}>
            {t('shop.listing.clear')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** "Load more" through fetchMore, and the retry when the next page didn't load. */
export const LoadMore = ({ listing }: { listing: Listing }) => {
  const { t } = useStorefront()
  if (!listing.hasMore) return null
  return (
    <div className="pt-3 flex flex-col items-center gap-y-2 gap-x-2">
      {listing.moreFailed ? (
        <p className="m-0 text-muted text-[14px]" role="alert">
          {t('shop.listing.moreFailed')}
        </p>
      ) : null}
      <button type="button" className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" disabled={listing.loadingMore} onClick={listing.fetchMore}>
        {t('shop.listing.more')}
      </button>
    </div>
  )
}
