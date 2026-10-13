import { useId, useState } from 'react'
import { blockKinds, contentLimits, type BlockKind, type ContentKind } from '../../api/content'
import { fill, messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import { ProductSearch } from '../common/ProductSearch'
import { moveBlock, newBlock, type DraftBlock } from './contentDraft'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.content.editor
const uploadWords = messages.storefront.brand.uploadRefused
const toolMarks: Record<BlockKind, string> = { heading: 'H', text: '¶', image: '▣', faq: '?', products: '◫', form: '✉' }

export interface ContentBlocksProps {
  kind: ContentKind
  title: string
  body: DraftBlock[]
  /** Each change is made to the blocks as they are then, so one an upload brings lands on edits made meanwhile. */
  onBody: (change: (was: DraftBlock[]) => DraftBlock[]) => void
  canEdit: boolean
  api: StorefrontApi
  /** Product names by id: null for one no longer in the catalogue, absent while unknown. */
  names: Record<string, string | null>
  /** The names couldn't be read, so one still unknown is shown as such rather than as loading. */
  namesFailed: boolean
  onName: (id: string, name: string) => void
  contactEmail: string | null
}

/** The page's blocks (StorefrontContent's block editor): add, move, remove and fill each kind. */
export const ContentBlocks = ({ kind, title, body, onBody, canEdit, api, names, namesFailed, onName, contactEmail }: ContentBlocksProps) => {
  const id = useId()
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const set = (index: number, patch: Partial<DraftBlock>) => onBody((was) => was.map((b, i) => (i === index ? { ...b, ...patch } : b)))
  const tools = blockKinds.filter((k) => k !== 'form' || kind === 'page')
  const full = body.length >= contentLimits.blocks

  const upload = (file: File) => {
    setUploading(true)
    setProblem(null)
    api.uploadImage(file).then(
      (r) => {
        setUploading(false)
        // Tools wait while a photo uploads, so it takes the place counted when it was picked.
        if (r.ok) onBody((was) => (was.length < contentLimits.blocks ? [...was, newBlock('image', { assetId: r.assetId })] : was))
        else setProblem(uploadWords[r.code])
      },
      () => {
        setUploading(false)
        setProblem(uploadWords.NOT_CONNECTED)
      },
    )
  }

  return (
    <section className="df-sf-card" aria-labelledby={`${id}-title`}>
      <div className="df-sfc-body-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {canEdit && (
          <span className="df-sfc-tools" role="group" aria-label={words.toolsLabel}>
            {tools.map((k) =>
              k === 'image' ? (
                <label key={k} className="df-sfc-tool" title={words.tools.image} data-disabled={full || uploading || undefined}>
                  <span aria-hidden="true">{toolMarks.image}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label={words.tools.image}
                    disabled={full || uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) upload(file)
                    }}
                  />
                </label>
              ) : (
                <button key={k} type="button" className="df-sfc-tool" title={words.tools[k]} aria-label={words.tools[k]} disabled={full || uploading} onClick={() => onBody((was) => [...was, newBlock(k)])}>
                  <span aria-hidden="true">{toolMarks[k]}</span>
                </button>
              ),
            )}
          </span>
        )}
      </div>
      {(uploading || problem) && (
        <span className={problem ? 'df-sf-problem' : 'df-sf-help'} role={problem ? 'alert' : 'status'}>
          {problem ?? words.uploading}
        </span>
      )}
      {body.map((b, i) => {
        const number = String(i + 1)
        const label = fill(words.blockText, { kind: words.kinds[b.kind], number })
        return (
          <div key={b.key} className="df-sfc-block" role="group" aria-label={label}>
            <div className="df-sfc-block-head">
              <span className="df-sfc-kind">{words.kinds[b.kind]}</span>
              {canEdit && (
                <span className="df-sfc-mini">
                  <button type="button" aria-label={fill(words.moveUp, { number })} disabled={i === 0} onClick={() => onBody((was) => moveBlock(was, i, -1))}>
                    ↑
                  </button>
                  <button type="button" aria-label={fill(words.moveDown, { number })} disabled={i === body.length - 1} onClick={() => onBody((was) => moveBlock(was, i, 1))}>
                    ↓
                  </button>
                  <button type="button" aria-label={fill(words.remove, { number })} onClick={() => onBody((was) => was.filter((_, j) => j !== i))}>
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
            {b.kind === 'image' && (
              <div className="df-sfc-photo">
                {b.assetId && <AssetImage url={`/api/assets/${b.assetId}`} alt={b.alt} className="df-sfc-photo-image" placeholder="" />}
                <input aria-label={fill(words.photoAlt, { number })} placeholder={words.photoAltHint} maxLength={contentLimits.alt} value={b.alt} readOnly={!canEdit} onChange={(e) => set(i, { alt: e.target.value })} />
              </div>
            )}
            {b.kind === 'faq' && (
              <div className="df-sfc-faq">
                {b.items.map((q, n) => {
                  const at = String(n + 1)
                  const change = (patch: Partial<typeof q>) => set(i, { items: b.items.map((x, m) => (m === n ? { ...x, ...patch } : x)) })
                  return (
                    <div key={n} className="df-sfc-question">
                      <input aria-label={fill(words.question, { number: at })} placeholder={fill(words.question, { number: at })} maxLength={contentLimits.question} value={q.question} readOnly={!canEdit} onChange={(e) => change({ question: e.target.value })} />
                      <textarea aria-label={fill(words.answer, { number: at })} placeholder={fill(words.answer, { number: at })} rows={2} maxLength={contentLimits.answer} value={q.answer} readOnly={!canEdit} onChange={(e) => change({ answer: e.target.value })} />
                      {canEdit && (
                        <button type="button" className="df-sf-link df-sf-link--danger" onClick={() => set(i, { items: b.items.filter((_, m) => m !== n) })}>
                          {fill(words.removeQuestion, { number: at })}
                        </button>
                      )}
                    </div>
                  )
                })}
                {canEdit && b.items.length < contentLimits.questions && (
                  <button type="button" className="df-sf-link" onClick={() => set(i, { items: [...b.items, { question: '', answer: '' }] })}>
                    {words.addQuestion}
                  </button>
                )}
              </div>
            )}
            {b.kind === 'products' && (
              <div className="df-sfc-products">
                <ul className="df-sfc-chips">
                  {b.productIds.map((p) => {
                    const name = names[p] === undefined ? (namesFailed ? words.unknownProduct : words.loadingProduct) : (names[p] ?? words.goneProduct)
                    return (
                      <li key={p}>
                        {name}
                        {canEdit && (
                          <button type="button" aria-label={fill(words.removeProduct, { name })} onClick={() => set(i, { productIds: b.productIds.filter((x) => x !== p) })}>
                            ✕
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {namesFailed && b.productIds.some((p) => names[p] === undefined) && (
                  <span className="df-sf-problem" role="alert">
                    {words.namesFailed}
                  </span>
                )}
                {canEdit && b.productIds.length < contentLimits.products && (
                  <ProductSearch
                    label={words.findProduct}
                    hide={b.productIds}
                    onPick={(p) => {
                      onName(p.id, p.name)
                      set(i, { productIds: [...b.productIds, p.id] })
                    }}
                  />
                )}
                <span className="df-sf-help">{words.productsHelp}</span>
              </div>
            )}
            {b.kind === 'form' && <p className="df-sfc-form">{fill(words.form, { email: contactEmail ?? words.formNoEmail })}</p>}
          </div>
        )
      })}
    </section>
  )
}
