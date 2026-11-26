import { isHttps } from '@dripfunnel/shared/format'
import { templatePicture } from '@dripfunnel/shared/templates'
import { useId, useState, type ReactNode } from 'react'
import { scratchTemplate, type StorefrontTemplate } from '../../api/storefront'
import { messages } from '../../messages'
import { SearchSelect } from '../common/SearchSelect'

const words = messages.storefront.gallery
// Tags are never empty (storefront_template's check), so '' can stand for every category.
const allTags = ''

/** The template's demo to link to: an https address only (FIRST-RELEASE §14), else none. */
export const demoUrlOf = (template: StorefrontTemplate): string | null => (template.demoUrl && isHttps(template.demoUrl) ? template.demoUrl : null)

export interface TemplateListProps {
  templates: readonly StorefrontTemplate[]
  /** Marks "Your current look"; the Templates showroom marks none. */
  isCurrent: (template: StorefrontTemplate) => boolean
  /** A card's buttons and links, each described by the template's name (`nameId`). */
  actions: (template: StorefrontTemplate, nameId: string) => ReactNode
}

/** The templates as the gallery draws them (PortalStorefront › gallery): the Category filter, then a card each. */
export const TemplateList = ({ templates, isCurrent, actions }: TemplateListProps) => {
  const filterId = useId()
  const [tag, setTag] = useState(allTags)
  // A template's tag is its category; "Start from scratch" isn't one, so it shows only under All.
  const tags = [...new Set(templates.filter((t) => t.key !== scratchTemplate).map((t) => t.tag))]
  const shown = tag === allTags ? templates : templates.filter((t) => t.key !== scratchTemplate && t.tag === tag)
  return (
    <>
      {tags.length > 1 && (
        <div className="df-sf-filter">
          <span id={filterId}>{words.filter.label}</span>
          <SearchSelect
            labelledBy={filterId}
            options={[{ id: allTags, label: words.filter.all }, ...tags.map((t) => ({ id: t, label: t }))]}
            value={tag}
            onChange={setTag}
            placeholder={words.filter.placeholder}
            noMatches={words.filter.noMatches}
          />
        </div>
      )}
      <ul className="df-sf-templates">
        {shown.map((t) => (
          <TemplateCard key={t.key} template={t} current={isCurrent(t)} actions={actions} />
        ))}
      </ul>
    </>
  )
}

const TemplateCard = ({ template, current, actions }: { template: StorefrontTemplate; current: boolean; actions: TemplateListProps['actions'] }) => {
  const nameId = useId()
  const [pictured, setPictured] = useState(true)
  const scratch = template.key === scratchTemplate
  return (
    <li className={`df-sf-template${scratch ? ' df-sf-template--scratch' : ''}${current ? ' df-sf-template--current' : ''}`}>
      {/* One picture per template, the same for every store; a key without one keeps the name tile (FIRST-RELEASE §14). */}
      <div className="df-sf-template-thumb">
        {pictured ? <img src={templatePicture(template.key)} alt="" loading="lazy" onError={() => setPictured(false)} /> : <span aria-hidden="true">{template.name}</span>}
      </div>
      {current && <span className="df-sf-badge">{words.current}</span>}
      <div className="df-sf-template-body">
        <div className="df-sf-template-name">
          <h2 id={nameId}>{template.name}</h2>
          <span>{template.tag}</span>
        </div>
        <p>{template.description}</p>
        <div className="df-sf-template-actions">{actions(template, nameId)}</div>
      </div>
    </li>
  )
}
