import { Link } from '@tanstack/react-router'
import type { CollectionSummary } from '../../api/collections'
import type { Facet } from '../../api/productEditor'
import { fill, formatCount, messages, plural } from '../../messages'
import { nested, rowsOf, sentenceOf } from './collectionDraft'
import type { SeasonKey } from './seasonal'

const words = messages.collections

export interface CollectionListProps {
  collections: readonly CollectionSummary[]
  facets: readonly Facet[]
  canEdit: boolean
  seasonal: readonly SeasonKey[]
  giftPrice: string
  onCreate: (name?: string) => void
}

/** Rules as the builder counts them: a filter with its values is one. */
const ruleCount = (c: CollectionSummary, facets: readonly Facet[]) => {
  const { rows, others } = rowsOf(c.rules, facets)
  return rows.length + others.length
}

const subOf = (c: CollectionSummary, all: readonly CollectionSummary[], facets: readonly Facet[]): string => {
  const parent = all.find((p) => p.id === c.parentId)
  if (parent) return fill(c.inheritParent ? words.list.insideOnly : words.list.inside, { name: parent.name })
  return c.kind === 'automatic' ? sentenceOf(c, facets, words.sentence) : fill(plural(words.list.picked, c.products), { count: formatCount(c.products) })
}

/** CatCollections' list: heading, seasonal ideas, then every collection with its children under it, or the empty state. */
export const CollectionList = ({ collections, facets, canEdit, seasonal, giftPrice, onCreate }: CollectionListProps) => {
  const names = new Set(collections.map((c) => c.name.toLowerCase()))
  const ideas = seasonal.filter((k) => !names.has(words.seasonal.names[k].toLowerCase()))
  return (
    <div className="df-colls">
      <div className="df-colls-head">
        <div>
          <h1 className="df-page-title">{words.title}</h1>
          <p className="df-page-lede">{words.sub}</p>
        </div>
        {canEdit && (
          <button type="button" className="df-button df-button--primary" onClick={() => onCreate()}>
            {words.create}
          </button>
        )}
      </div>
      {canEdit && ideas.length > 0 && (
        <div className="df-colls-seasonal">
          <span>{words.seasonal.label}</span>
          {ideas.map((k) => (
            <button key={k} type="button" onClick={() => onCreate(words.seasonal.names[k])}>
              {fill(words.seasonal.add, { name: words.seasonal.names[k] })}
            </button>
          ))}
        </div>
      )}
      {!canEdit && <p className="df-colls-note">{words.viewOnly}</p>}
      {collections.length === 0 ? (
        <section className="df-colls-empty" aria-labelledby="df-colls-empty-title">
          <h2 id="df-colls-empty-title">{words.empty.title}</h2>
          <p>{fill(words.empty.body, { price: giftPrice })}</p>
          {canEdit && (
            <button type="button" className="df-button df-button--primary" onClick={() => onCreate()}>
              {words.empty.action}
            </button>
          )}
        </section>
      ) : (
        <ul className="df-colls-list" aria-label={words.list.label}>
          {nested(collections).map(({ c, depth }) => {
            const updating = c.kind === 'automatic' && c.computedAt === null
            return (
              <li key={c.id}>
                <Link to="/collections" search={{ edit: c.id }} className="df-colls-row" aria-label={fill(words.list.open, { name: c.name })}>
                  <span className="df-colls-name" style={{ paddingInlineStart: `${depth * 28}px` }}>
                    <span className="df-colls-thumb" aria-hidden="true" />
                    <span>
                      <strong>{c.name}</strong>
                      <span>{subOf(c, collections, facets)}</span>
                    </span>
                  </span>
                  <span className="df-colls-type">{c.kind === 'automatic' ? fill(plural(words.list.automatic, ruleCount(c, facets)), { count: formatCount(ruleCount(c, facets)) }) : words.list.handPicked}</span>
                  <span className={updating ? 'df-colls-count df-colls-count--updating' : 'df-colls-count'}>
                    {updating ? fill(words.list.updating, { count: formatCount(c.products) }) : fill(plural(words.list.products, c.products), { count: formatCount(c.products) })}
                  </span>
                  <span className={c.visible ? 'df-colls-vis df-colls-vis--on' : 'df-colls-vis'}>{c.visible ? words.list.visible : words.list.hidden}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
