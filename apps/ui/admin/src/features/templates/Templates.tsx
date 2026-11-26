// States (?state=): loading, empty, error; see templatesHarness.ts.
import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { englishName } from '../../api/storeCategories'
import { collectionsOf, type StorefrontTemplate, type TemplateCollection } from '../../api/templates'
import { fill, formatCount, messages, plural } from '../../messages'
import { EmptyState, ErrorState, FilterSelect, ListHeader, LoadingState, StatusPill } from '@dripfunnel/shared/ui'
import { templatePicture } from '@dripfunnel/shared/templates'
import type { TemplatesScreenState } from './templatesHarness'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'
import './templates.css'

const words = messages.templates

const Header = ({ title = words.title, sub = words.sub, action }: { title?: string; sub?: string; action?: ReactNode }) => (
  <ListHeader level={words.level} title={title} sub={sub} action={action} />
)

export const TemplatesLoading = () => (
  <div className="df-page df-list">
    <Header />
    <LoadingState label={words.loading} rows={4} />
  </div>
)

export const TemplatesError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const countText = (forms: { one: string; other: string }, count: number) => fill(plural(forms, count), { count: formatCount(count) })

// The picture the merchant gallery shows; a key without one keeps a name tile.
const Picture = ({ templateKey, name }: { templateKey: string; name: string }) => {
  const [pictured, setPictured] = useState(true)
  return (
    <div className="df-template-thumb">
      {pictured ? <img src={templatePicture(templateKey)} alt="" loading="lazy" onError={() => setPictured(false)} /> : <span aria-hidden="true">{name}</span>}
    </div>
  )
}

// Only a category template has a demo store (decided 2026-11-24): the rest say so rather than offer a dead button. A
// Super admin's first Preview sets the demo up; every other role waits for it.
const Preview = ({ template, canMake, opening, onPreview }: { template: StorefrontTemplate; canMake: boolean; opening: boolean; onPreview: () => void }) => {
  if (template.categories.length === 0) return <span className="df-muted">{words.demo.none}</span>
  if (template.demo === 'creating') return <StatusPill tone="info" icon="clock" label={words.demo.creating} />
  if (template.demo === 'none' && !canMake) return <span className="df-muted">{words.demo.noDemo}</span>
  return (
    <button type="button" className="df-button df-button--primary" aria-label={`${words.preview}: ${template.name}`} aria-describedby="df-template-preview-note" disabled={opening} onClick={onPreview}>
      {opening ? words.opening : words.preview}
    </button>
  )
}

interface TemplateCardsProps {
  templates: readonly StorefrontTemplate[]
  label: string
  /** May set up a template's demo store with its first Preview (Super admin). */
  canMake: boolean
  /** The template whose link is being made, so its button waits. */
  opening: string | null
  onPreview: (template: StorefrontTemplate) => void
}

/** A card per template: its picture, categories, stores and Preview. */
const TemplateCards = ({ templates, label, canMake, opening, onPreview }: TemplateCardsProps) => (
  <>
    <p id="df-template-preview-note" className="df-muted">
      {words.previewNote}
    </p>
    <ul className="df-template-grid" aria-label={label}>
      {templates.map((template) => (
        <li key={template.key} id={template.key} className="df-template-card">
          <Picture templateKey={template.key} name={template.name} />
          <div className="df-template-body">
            <div className="df-template-title">
              <h2 className="df-template-name">{template.name}</h2>
              <span className="df-template-key">{template.key}</span>
            </div>
            {template.state === 'retired' && <StatusPill tone="neutral" icon="clock" label={words.retired} />}
            <p className="df-muted">{template.description}</p>
            <dl className="df-template-facts">
              <dt>{words.columns.categories}</dt>
              <dd>{template.categories.length === 0 ? words.noCategory : template.categories.map(englishName).join(', ')}</dd>
              <dt>{words.columns.stores}</dt>
              <dd>{countText(words.stores, template.storeCount)}</dd>
            </dl>
            <div className="df-template-actions">
              <Preview template={template} canMake={canMake} opening={opening === template.key} onPreview={() => onPreview(template)} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  </>
)

export interface TemplateCollectionsProps extends Omit<TemplateCardsProps, 'templates' | 'label'> {
  templates: readonly StorefrontTemplate[]
  /** Every store category, for the filter. */
  categories: readonly { id: string; name: string }[]
  /** The category filtered to, from `?category=`. */
  category: string | undefined
  forced: TemplatesScreenState | null
  onCategory: (category: string | undefined) => void
  onReload: () => void
}

/** `/templates`: one card per collection (a tag, storefront ARCHITECTURE §2.3), opening its templates; filtered to a
 * category, that category's templates as cards with Preview. */
export const TemplateCollections = ({ templates, categories, category, forced, canMake, opening, onPreview, onCategory, onReload }: TemplateCollectionsProps) => {
  if (forced === 'loading') return <TemplatesLoading />
  if (forced === 'error') return <TemplatesError onRetry={onReload} />
  if (forced === 'empty' || templates.length === 0) {
    return (
      <div className="df-page df-list">
        <Header />
        <EmptyState title={words.empty.title} body={words.empty.body} />
      </div>
    )
  }
  const chosen = category ? categories.find((c) => c.id === category) : undefined
  return (
    <div className="df-page df-list">
      <Header />
      <form role="search" aria-label={words.filters.label} className="df-list-filters" onSubmit={(event) => event.preventDefault()}>
        <FilterSelect
          label={words.filters.category}
          anyLabel={words.filters.anyCategory}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={chosen?.id}
          onChange={onCategory}
        />
        {chosen && (
          <button type="button" className="df-link-button" onClick={() => onCategory(undefined)}>
            {words.filters.clear}
          </button>
        )}
      </form>
      {chosen ? (
        <CategoryTemplates
          templates={templates.filter((t) => t.categories.some((c) => c.id === chosen.id))}
          name={chosen.name}
          canMake={canMake}
          opening={opening}
          onPreview={onPreview}
        />
      ) : (
        <ul className="df-template-grid" aria-label={words.collectionsLabel}>
          {collectionsOf(templates).map((collection) => {
            const first = collection.templates[0]
            return (
              <li key={collection.key} className="df-template-card">
                <Link to="/templates/$collection" params={{ collection: collection.key }} preload="intent" className="df-template-card-link">
                  {first && <Picture templateKey={first.key} name={collection.name} />}
                  <div className="df-template-body">
                    <h2 className="df-template-name">{collection.name}</h2>
                    <p className="df-muted">{collection.templates.map((t) => t.name).join(', ')}</p>
                    <span className="df-template-count">{countText(words.templateCount, collection.templates.length)}</span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

const CategoryTemplates = ({ templates, name, ...cards }: Omit<TemplateCardsProps, 'label'> & { name: string }) =>
  templates.length === 0 ? (
    <EmptyState title={words.noneForCategory.title} body={fill(words.noneForCategory.body, { name })} />
  ) : (
    <TemplateCards templates={templates} label={fill(words.templatesLabel, { name })} {...cards} />
  )

export interface TemplateCollectionProps extends Omit<TemplateCardsProps, 'templates' | 'label'> {
  /** Null when no template has this collection's address. */
  collection: TemplateCollection | null
  forced: TemplatesScreenState | null
  onReload: () => void
}

const Back = () => (
  <Link to="/templates" className="df-button">
    {words.back}
  </Link>
)

/** `/templates/{collection}`: its templates as cards, each with its categories, stores and Preview. */
export const TemplateCollectionView = ({ collection, forced, canMake, opening, onPreview, onReload }: TemplateCollectionProps) => {
  if (forced === 'loading') return <TemplatesLoading />
  if (forced === 'error') return <TemplatesError onRetry={onReload} />
  if (!collection || forced === 'empty') {
    return (
      <div className="df-page df-list">
        <Header />
        <EmptyState title={words.missing.title} body={words.missing.body} action={<Back />} />
      </div>
    )
  }
  return (
    <div className="df-page df-list">
      <nav aria-label={words.breadcrumb} className="df-template-crumbs">
        <Link to="/templates">{words.title}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{collection.name}</span>
      </nav>
      <Header title={collection.name} sub={countText(words.templateCount, collection.templates.length)} />
      <TemplateCards templates={collection.templates} label={fill(words.templatesLabel, { name: collection.name })} canMake={canMake} opening={opening} onPreview={onPreview} />
    </div>
  )
}
