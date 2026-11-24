// States (?state=): loading, empty, error; see templatesHarness.ts.
import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { englishName } from '../../api/storeCategories'
import type { StorefrontTemplate, TemplateCollection } from '../../api/templates'
import { fill, formatCount, messages, plural } from '../../messages'
import { EmptyState, ErrorState, ListHeader, LoadingState, StatusPill } from '@dripfunnel/shared/ui'
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

export interface TemplateCollectionsProps {
  collections: readonly TemplateCollection[]
  forced: TemplatesScreenState | null
  onReload: () => void
}

/** `/templates`: one card per collection (a tag, storefront ARCHITECTURE §2.3), opening its templates. */
export const TemplateCollections = ({ collections, forced, onReload }: TemplateCollectionsProps) => {
  if (forced === 'loading') return <TemplatesLoading />
  if (forced === 'error') return <TemplatesError onRetry={onReload} />
  if (forced === 'empty' || collections.length === 0) {
    return (
      <div className="df-page df-list">
        <Header />
        <EmptyState title={words.empty.title} body={words.empty.body} />
      </div>
    )
  }
  return (
    <div className="df-page df-list">
      <Header />
      <ul className="df-template-grid" aria-label={words.collectionsLabel}>
        {collections.map((collection) => {
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

export interface TemplateCollectionProps {
  /** Null when no template has this collection's address. */
  collection: TemplateCollection | null
  forced: TemplatesScreenState | null
  /** May set up a template's demo store with its first Preview (Super admin). */
  canMake: boolean
  /** The template whose link is being made, so its button waits. */
  opening: string | null
  onPreview: (template: StorefrontTemplate) => void
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
      <p id="df-template-preview-note" className="df-muted">
        {words.previewNote}
      </p>
      <ul className="df-template-grid" aria-label={fill(words.templatesLabel, { name: collection.name })}>
        {collection.templates.map((template) => (
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
    </div>
  )
}
