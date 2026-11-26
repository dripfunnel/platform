// States (?state=): loading, empty, error, readonly, confirm; see storeCategoriesHarness.ts.
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { englishName, type StoreCategory } from '../../api/storeCategories'
import { collectionKeyOf } from '../../api/templates'
import { fill, formatCount, formatDate, messages, plural } from '../../messages'
import { EmptyState, ErrorState, ListHeader, LoadingState, ReadOnlyNotice, StatusPill } from '@dripfunnel/shared/ui'
import type { StoreCategoriesScreenState } from './storeCategoriesHarness'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'
import './storeCategories.css'

const words = messages.storeCategories

export type CategoryAction = 'edit' | 'archive' | 'restore' | 'addDefaultSample' | 'removeSample'

export interface StoreCategoriesProps {
  categories: readonly StoreCategory[]
  forced: StoreCategoriesScreenState | null
  canManage: boolean
  onAdd: () => void
  onAction: (action: CategoryAction, category: StoreCategory) => void
  onReload: () => void
}

const Header = ({ action }: { action?: ReactNode | undefined }) => <ListHeader level={words.level} title={words.title} sub={words.sub} action={action} />

export const StoreCategoriesLoading = () => (
  <div className="df-page df-list">
    <Header />
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const StoreCategoriesError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

export const storeCountText = (count: number): string => fill(plural(words.stores, count), { count: formatCount(count) })

// Archived ones last, as the API orders them; kept here too so a just-archived row moves down without a reload.
const ordered = (categories: readonly StoreCategory[]) => [...categories.filter((c) => !c.archivedAt), ...categories.filter((c) => c.archivedAt)]

/** "Sample: 6 products · 2 collections · INR · added 16 Nov 2026", or "No sample" (CATALOG-DESIGN K13a). */
export const sampleText = (sample: StoreCategory['sample']): string =>
  sample
    ? fill(words.sample.status, {
        products: fill(plural(words.sample.products, sample.products), { count: formatCount(sample.products) }),
        collections: fill(plural(words.sample.collections, sample.collections.length), { count: formatCount(sample.collections.length) }),
        currency: sample.currency,
        date: formatDate(sample.uploadedAt),
      })
    : words.sample.none

const Row = ({ category, manage, onAction }: { category: StoreCategory; manage: boolean; onAction: StoreCategoriesProps['onAction'] }) => {
  const name = englishName(category)
  return (
    <tr>
      <th scope="row">
        <div className="df-stack">
          <strong>{name}</strong>
          {category.archivedAt && <StatusPill tone="neutral" icon="clock" label={words.archived} />}
          <span className="df-muted df-category-sample">{sampleText(category.sample)}</span>
          {(category.sample || manage) && (
            <Link to="/categories/$categoryId/sample" params={{ categoryId: category.id }} className="df-category-sample-link" aria-label={`${category.sample ? words.sample.view : words.sample.create}: ${name}`}>
              {category.sample ? words.sample.view : words.sample.create}
            </Link>
          )}
          <Link to="/templates" search={{ category: category.id }} className="df-category-sample-link" aria-label={`${words.templates}: ${name}`}>
            {words.templates}
          </Link>
        </div>
      </th>
      <td className="df-muted df-nowrap">{category.key}</td>
      <td>
        {category.sections.length === 0 ? (
          <span className="df-muted">{words.noSections}</span>
        ) : (
          <ul className="df-category-sections">
            {category.sections.map((s) => (
              <li key={s} className="df-category-section">
                {words.sections[s]}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="df-nowrap">
        {category.template ? (
          <Link to="/templates/$collection" params={{ collection: collectionKeyOf(category.template.tag) }} hash={category.template.key}>
            {category.template.name}
          </Link>
        ) : (
          <span className="df-muted">{words.noTemplate}</span>
        )}
      </td>
      <td className="df-nowrap">{storeCountText(category.storeCount)}</td>
      {manage && (
        <td>
          <div className="df-category-actions">
            <button type="button" className="df-button df-button--small" aria-label={`${words.edit}: ${name}`} onClick={() => onAction('edit', category)}>
              {words.edit}
            </button>
            {category.hasDefaultSample && (
              <button type="button" className="df-button df-button--small" aria-label={`${category.sample ? words.sample.reset : words.sample.addDefault}: ${name}`} onClick={() => onAction('addDefaultSample', category)}>
                {category.sample ? words.sample.reset : words.sample.addDefault}
              </button>
            )}
            {category.sample && (
              <button type="button" className="df-button df-button--small" aria-label={`${words.sample.remove}: ${name}`} onClick={() => onAction('removeSample', category)}>
                {words.sample.remove}
              </button>
            )}
            {category.archivedAt ? (
              <button type="button" className="df-button df-button--small" aria-label={`${words.restore}: ${name}`} onClick={() => onAction('restore', category)}>
                {words.restore}
              </button>
            ) : (
              <button type="button" className="df-button df-button--small" aria-label={`${words.archive}: ${name}`} onClick={() => onAction('archive', category)}>
                {words.archive}
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  )
}

export const StoreCategories = ({ categories, forced, canManage, onAdd, onAction, onReload }: StoreCategoriesProps) => {
  if (forced === 'loading') return <StoreCategoriesLoading />
  if (forced === 'error') return <StoreCategoriesError onRetry={onReload} />

  const manage = canManage && forced !== 'readonly'
  const add = manage ? (
    <button type="button" className="df-button df-button--primary" onClick={onAdd}>
      {words.add}
    </button>
  ) : undefined

  if (forced === 'empty' || categories.length === 0) {
    return (
      <div className="df-page df-list">
        <Header action={add} />
        {!manage && <ReadOnlyNotice title={words.readOnly.title} body={words.readOnly.body} />}
        <EmptyState title={words.empty.title} body={words.empty.body} />
      </div>
    )
  }

  const columns = [words.columns.name, words.columns.key, words.columns.sections, words.columns.template, words.columns.stores, ...(manage ? [words.columns.actions] : [])]
  return (
    <div className="df-page df-list">
      <Header action={add} />
      {!manage && <ReadOnlyNotice title={words.readOnly.title} body={words.readOnly.body} />}
      <div className="df-table-scroll" role="region" aria-label={words.listLabel} tabIndex={0}>
        <table className="df-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered(categories).map((category) => (
              <Row key={category.id} category={category} manage={manage} onAction={onAction} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
