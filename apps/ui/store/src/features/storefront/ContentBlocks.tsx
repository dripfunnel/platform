import { useId } from 'react'
import { contentLimits, type BlockKind } from '../../api/content'
import { fill, messages } from '../../messages'
import { moveBlock, newBlock, type DraftBlock } from './contentDraft'

const words = messages.storefront.content.editor
const tools: readonly { kind: BlockKind; mark: string }[] = [
  { kind: 'heading', mark: 'H' },
  { kind: 'text', mark: '¶' },
]

export interface ContentBlocksProps {
  title: string
  body: DraftBlock[]
  onBody: (body: DraftBlock[]) => void
  canEdit: boolean
}

/** The page's blocks (StorefrontContent's block editor): add, move, remove and fill each kind. */
export const ContentBlocks = ({ title, body, onBody, canEdit }: ContentBlocksProps) => {
  const id = useId()
  const set = (index: number, patch: Partial<DraftBlock>) => onBody(body.map((b, i) => (i === index ? { ...b, ...patch } : b)))
  const full = body.length >= contentLimits.blocks

  return (
    <section className="df-sf-card" aria-labelledby={`${id}-title`}>
      <div className="df-sfc-body-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {canEdit && (
          <span className="df-sfc-tools" role="group" aria-label={words.toolsLabel}>
            {tools.map((t) => (
              <button key={t.kind} type="button" className="df-sfc-tool" title={words.tools[t.kind]} aria-label={words.tools[t.kind]} disabled={full} onClick={() => onBody([...body, newBlock(t.kind)])}>
                <span aria-hidden="true">{t.mark}</span>
              </button>
            ))}
          </span>
        )}
      </div>
      {body.map((b, i) => {
        const number = String(i + 1)
        const label = fill(words.blockText, { kind: words.kinds[b.kind], number })
        return (
          <div key={b.key} className="df-sfc-block" role="group" aria-label={label}>
            <div className="df-sfc-block-head">
              <span className="df-sfc-kind">{words.kinds[b.kind]}</span>
              {canEdit && (
                <span className="df-sfc-mini">
                  <button type="button" aria-label={fill(words.moveUp, { number })} disabled={i === 0} onClick={() => onBody(moveBlock(body, i, -1))}>
                    ↑
                  </button>
                  <button type="button" aria-label={fill(words.moveDown, { number })} disabled={i === body.length - 1} onClick={() => onBody(moveBlock(body, i, 1))}>
                    ↓
                  </button>
                  <button type="button" aria-label={fill(words.remove, { number })} onClick={() => onBody(body.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </span>
              )}
            </div>
            {(b.kind === 'heading' || b.kind === 'text') && (
              <textarea
                className={b.kind === 'heading' ? 'df-sfc-heading' : 'df-sfc-text'}
                aria-label={label}
                rows={b.kind === 'heading' ? 1 : 4}
                maxLength={b.kind === 'heading' ? contentLimits.heading : contentLimits.text}
                value={b.text}
                readOnly={!canEdit}
                onChange={(e) => set(i, { text: e.target.value })}
              />
            )}
          </div>
        )
      })}
    </section>
  )
}
