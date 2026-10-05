import { fill, messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import type { DraftModule, DraftPhoto } from './storyDraft'

const words = messages.story

const Picture = ({ photo, className }: { photo: DraftPhoto; className: string }) =>
  photo.assetId ? <AssetImage className={className} url={`/api/assets/${photo.assetId}`} alt={photo.alt} placeholder="" /> : <span className={`${className} ${className}--empty`} aria-hidden="true" />

/** How a module reads on the product page: its photo and words, or grey where something is still to come. */
const Preview = ({ m, names }: { m: DraftModule; names: Readonly<Record<string, string>> }) => {
  const title = m.title.trim() || (words.placeholders as Record<string, string>)[m.kind] || ''
  switch (m.kind) {
    case 'banner':
      return (
        <div className="df-story-banner">
          <Picture photo={m.photo} className="df-story-fill" />
          <span className="df-story-banner-title">{title}</span>
        </div>
      )
    case 'imageText':
      return (
        <div className={`df-story-imagetext df-story-imagetext--${m.side}`}>
          <Picture photo={m.photo} className="df-story-pic" />
          <div>
            <strong>{title}</strong>
            <span>{m.body.trim() || words.placeholders.text}</span>
          </div>
        </div>
      )
    case 'features':
      return (
        <div>
          <strong className="df-story-heading">{title}</strong>
          <div className="df-story-features">
            {m.items.map((item, i) => (
              <div key={i}>
                <Picture photo={item.photo} className="df-story-pic" />
                <strong>{item.title.trim() || words.placeholders.item}</strong>
                {item.text.trim() && <span>{item.text}</span>}
              </div>
            ))}
          </div>
        </div>
      )
    case 'gallery':
      return (
        <div>
          <strong className="df-story-heading">{title}</strong>
          <div className="df-story-features">{m.photos.length > 0 ? m.photos.map((p, i) => <Picture key={i} photo={p} className="df-story-pic" />) : <Picture photo={{ assetId: null, alt: '' }} className="df-story-pic" />}</div>
        </div>
      )
    case 'box':
      return (
        <div>
          <strong className="df-story-heading">{title}</strong>
          <ul className="df-story-box">{m.items.map((item, i) => <li key={i}>{item.title.trim() || words.placeholders.item}</li>)}</ul>
        </div>
      )
    case 'compare':
      return (
        <div>
          <strong className="df-story-heading">{title}</strong>
          <div className="df-story-features">
            {m.productIds.map((id) => (
              <span key={id} className="df-story-compare">
                {names[id] ?? words.panel.compareGone}
              </span>
            ))}
          </div>
          <span className="df-story-hint">{words.panel.compareNote}</span>
        </div>
      )
    case 'brand':
      return <strong className="df-story-heading">{words.kinds.brand}</strong>
    case 'specs':
    case 'faq':
    case 'video':
      return (
        <div>
          <strong className="df-story-heading">{title}</strong>
          <span className="df-story-hint">{m.kind === 'video' ? m.videoUrl || words.panel.videoHint : fill(words.panel.fromProduct, { what: m.kind === 'specs' ? words.panel.fromSpecs : words.panel.fromFaqs })}</span>
        </div>
      )
  }
}

export interface CanvasActions {
  select: (id: string) => void
  move: (index: number, by: -1 | 1) => void
  duplicate: (index: number) => void
  remove: (index: number) => void
}

/** The draft as shoppers will see it, desktop or phone width; the selected module carries its tools. */
export const StoryCanvas = ({ modules, selected, view, disabled, marked, names, actions }: { modules: readonly DraftModule[]; selected: string | null; view: 'desktop' | 'phone'; disabled: boolean; marked: ReadonlySet<string>; names: Readonly<Record<string, string>>; actions: CanvasActions }) => (
  <div className="df-story-canvas-wrap">
    <div className={`df-story-canvas df-story-canvas--${view}`}>
      {modules.length === 0 && <p className="df-story-empty">{words.empty}</p>}
      {modules.map((m, i) => {
        const on = m.id === selected
        return (
          <section key={m.id} className={['df-story-module', on ? 'df-story-module--selected' : '', marked.has(m.id) ? 'df-story-module--marked' : ''].join(' ')} aria-label={words.kinds[m.kind]}>
            <button type="button" className="df-story-module-hit" aria-pressed={on} aria-label={fill(words.select, { name: words.kinds[m.kind] })} onClick={() => actions.select(m.id)} />
            <Preview m={m} names={names} />
            {on && !disabled && (
              <span className="df-story-tools">
                <button type="button" aria-label={words.up} disabled={i === 0} onClick={() => actions.move(i, -1)}>
                  ↑
                </button>
                <button type="button" aria-label={words.down} disabled={i === modules.length - 1} onClick={() => actions.move(i, 1)}>
                  ↓
                </button>
                <button type="button" onClick={() => actions.duplicate(i)}>
                  {words.duplicate}
                </button>
                <button type="button" onClick={() => actions.remove(i)}>
                  {words.delete}
                </button>
              </span>
            )}
          </section>
        )
      })}
    </div>
  </div>
)
