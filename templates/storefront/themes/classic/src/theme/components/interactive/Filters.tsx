'use client'

import { useState } from 'react'
import { Checkbox, Select, useStorefront, type Listing, type SortKey } from '@dripfunnel/storefront-core/theme'
import styles from '../../styles/shop.module.css'

/** The filter values, a sidebar on wide screens and a panel the Filters button opens on narrow ones. */
export const FilterPanel = ({ listing }: { listing: Listing }) => {
  const { t } = useStorefront()
  const [open, setOpen] = useState(false)
  if (listing.facets.length === 0) return null
  return (
    <aside className={styles.filters}>
      <button type="button" className={styles.filterToggle} aria-expanded={open} aria-controls="listing-filters" onClick={() => setOpen(!open)}>
        {open ? t('shop.listing.filtersShown') : t('shop.listing.filters')}
        {listing.selected.length ? <span className={styles.count}>{listing.selected.length}</span> : null}
      </button>
      <div id="listing-filters" className={open ? styles.filterBodyOpen : styles.filterBody}>
        {listing.facets.map((facet) => (
          <div key={facet.id} role="group" aria-label={facet.name} className={styles.facet}>
            <p className={styles.facetName}>{facet.name}</p>
            {facet.values.map((value) => (
              <Checkbox key={value.id} checked={value.selected} onChange={() => listing.toggle(value.id)} className={styles.check}>
                {value.name} <span className={styles.muted}>({value.count})</span>
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
    <div className={styles.toolbar}>
      <p className={styles.muted} role="status">
        {t('shop.listing.showing', { count: listing.items.length })}
      </p>
      <Select label={t('shop.listing.sort')} value={listing.sort} options={listing.sorts.map((s) => ({ value: s, label: labels[s] }))} onChange={listing.setSort} className={styles.sort} />
      <div className={styles.chips}>
        {listing.selected.map((s) => (
          <button key={s.id} type="button" className={styles.chip} aria-label={t('shop.listing.remove', { name: s.name })} onClick={() => listing.toggle(s.id)}>
            {s.name}
            <svg className={styles.chipIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        ))}
        {listing.selected.length > 1 ? (
          <button type="button" className={styles.clear} onClick={listing.clear}>
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
    <div className={styles.more}>
      {listing.moreFailed ? (
        <p className={styles.muted} role="alert">
          {t('shop.listing.moreFailed')}
        </p>
      ) : null}
      <button type="button" className={styles.secondary} disabled={listing.loadingMore} onClick={listing.fetchMore}>
        {t('shop.listing.more')}
      </button>
    </div>
  )
}
