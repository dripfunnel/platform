import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, ErrorState, Icon, LoadingState } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { deleteCollection, loadCollection, previewCollection, saveCollection, searchPickable, type Collection, type CollectionSummary, type Pickable, type Preview, type RuleInput } from '../../api/collections'
import { loadMenu } from '../../api/menu'
import { uploadPhoto, type Facet } from '../../api/productEditor'
import { fill, formatCount, messages, plural } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import { ImageField } from '../common/ImageField'
import '../common/switch.css'
import { slugOf } from '../common/slug'
import { blankDraft, blockFields, draftOf, nameField, newBlock, onlyPicks, ruleInputs, type Block, type CollectionDraft } from './collectionDraft'

const words = messages.collections.editor
const imageWords = { upload: words.uploadImage, replace: words.replaceImage, uploading: words.uploadingImage, remove: words.removeImage }

const refusalOf = (error: unknown): string => (isApiError(error) ? ((messages.collections.refused as Record<string, string>)[error.code] ?? messages.collections.refused.other) : messages.collections.refused.other)

type Loaded = { kind: 'loading' } | { kind: 'failed' } | { kind: 'missing' } | { kind: 'ready'; slug: string | null; inMenu: boolean | null }
type PreviewView = { kind: 'idle' } | { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; preview: Preview }
type Search = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; rows: Pickable[] }
type Tile = { id: string; name: string; image: string | null }

/** What the editor reads: the API, or the ?state= harness's samples. */
export interface EditorReads {
  collection: (id: string) => Promise<Collection | null>
  preview: (draft: { rules: RuleInput[]; parentId: string | null; inheritParent: boolean }) => Promise<Preview>
  search: (query: string) => Promise<Pickable[]>
}

const apiReads: EditorReads = { collection: loadCollection, preview: previewCollection, search: searchPickable }

export interface CollectionEditorProps {
  /** A collection's id, or `new`. */
  id: string
  /** A new collection's name from a seasonal suggestion: it starts as a Pick products block, as the prototype starts one. */
  suggested: string | null
  facets: readonly Facet[]
  collections: readonly CollectionSummary[]
  pricingCurrency: string | null
  canEdit: boolean
  onDone: (toast: string) => void
  reads?: EditorReads
}

const BlockBody = ({ block, n, fields, disabled, onChange, picks }: { block: Block; n: number; fields: readonly Facet[]; disabled: boolean; onChange: (block: Block) => void; picks: ReactNode }) => {
  const facet = fields.find((f) => f.id === block.field)
  if (block.kind === 'picks') return <>{picks}</>
  if (block.kind === 'kept') return <p className="df-coll-hint">{block.rule?.kind === 'product' ? words.keptProduct : block.rule?.kind === 'version' ? words.keptVersion : words.keptPrice}</p>
  return (
    <div className="df-coll-rule">
      <select aria-label={fill(words.field, { n: String(n) })} value={block.kind === 'name' ? nameField : block.field} disabled={disabled} onChange={(e) => onChange(e.target.value === nameField ? { ...block, kind: 'name', field: nameField, values: [], text: '' } : { ...block, kind: 'filter', field: e.target.value, values: [], text: '' })}>
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
        <option value={nameField}>{words.nameContains}</option>
      </select>
      {block.kind === 'name' ? (
        <input aria-label={fill(words.text, { n: String(n) })} value={block.text} readOnly={disabled} placeholder={words.textPlaceholder} maxLength={60} onChange={(e) => onChange({ ...block, text: e.target.value })} />
      ) : (
        <>
          <span>{words.is}</span>
          {facet?.values.map((v) => {
            const on = block.values.includes(v.id)
            return (
              <button key={v.id} type="button" className="df-coll-chip" aria-pressed={on} disabled={disabled} onClick={() => onChange({ ...block, values: on ? block.values.filter((x) => x !== v.id) : [...block.values, v.id] })}>
                {v.name}
              </button>
            )
          })}
          <select aria-label={fill(words.matchLabel, { n: String(n) })} value={block.match} disabled={disabled} onChange={(e) => onChange({ ...block, match: e.target.value === 'all' ? 'all' : 'any' })}>
            <option value="any">{words.matchAnyOf}</option>
            <option value="all">{words.matchAllOf}</option>
          </select>
        </>
      )}
    </div>
  )
}

/** The AND / OR between two blocks: AND needs both, OR takes either (AND binds tighter, so the card says so). */
const JoinSwitch = ({ joiner, n, disabled, onChange }: { joiner: 'and' | 'or'; n: number; disabled: boolean; onChange: (joiner: 'and' | 'or') => void }) => (
  <div className="df-coll-join" role="group" aria-label={fill(words.joinLabel, { n: String(n), m: String(n + 1) })}>
    {(['and', 'or'] as const).map((j) => (
      <button key={j} type="button" aria-pressed={joiner === j} disabled={disabled} title={j === 'and' ? words.joinAndHint : words.joinOrHint} onClick={() => onChange(j)}>
        {j === 'and' ? words.joinAnd : words.joinOr}
      </button>
    ))}
  </div>
)

/** CatCollections' editor: name, how it fills (rules or picks), its parent, visibility, and the live preview beside them. */
export const CollectionEditor = ({ id, suggested, facets, collections, pricingCurrency, canEdit, onDone, reads = apiReads }: CollectionEditorProps) => {
  const isNew = id === 'new'
  const formId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState<Loaded>(isNew ? { kind: 'ready', slug: null, inMenu: false } : { kind: 'loading' })
  const [draft, setDraft] = useState<CollectionDraft>(() => (isNew ? { ...blankDraft(facets), ...(suggested ? { name: suggested, blocks: [newBlock('picks')] } : {}) } : blankDraft(facets)))
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [imageProblem, setImageProblem] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewView>({ kind: 'idle' })
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<Search>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (isNew) return
    let live = true
    setLoaded({ kind: 'loading' })
    void reads.collection(id).then(
      async (c) => {
        if (!live) return
        if (!c) return setLoaded({ kind: 'missing' })
        const menu = await loadMenu().catch(() => undefined)
        if (!live) return
        setDraft(draftOf(c, facets))
        setLoaded({ kind: 'ready', slug: c.slug, inMenu: menu === undefined ? null : (menu?.items ?? []).some((i) => i.collectionId === c.id) })
      },
      () => live && setLoaded({ kind: 'failed' }),
    )
    return () => {
      live = false
    }
  }, [id, isNew, facets, attempt, reads])

  // Opened from the list: the name takes focus, so its arrival is announced (WCAG 2.4.3).
  useEffect(() => {
    if (loaded.kind === 'ready') nameRef.current?.focus()
  }, [loaded.kind])

  const rules = ruleInputs(draft.blocks)
  const rulesKey = JSON.stringify([rules, draft.parentId, draft.inheritParent])
  useEffect(() => {
    if (loaded.kind !== 'ready') return setPreview({ kind: 'idle' })
    let live = true
    setPreview({ kind: 'loading' })
    const timer = setTimeout(
      () =>
        void reads.preview({ rules, parentId: draft.parentId, inheritParent: draft.inheritParent }).then(
          (p) => live && setPreview({ kind: 'ready', preview: p }),
          () => live && setPreview({ kind: 'failed' }),
        ),
      300,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
    // rulesKey stands for the blocks and the parent, which are rebuilt each render.
  }, [rulesKey, loaded.kind, reads])

  const hasPicks = draft.blocks.some((b) => b.kind === 'picks')
  useEffect(() => {
    if (!hasPicks) return
    let live = true
    setSearch({ kind: 'loading' })
    const timer = setTimeout(
      () =>
        void reads.search(query.trim()).then(
          (rows) => {
            if (!live) return
            setSearch({ kind: 'ready', rows })
          },
          () => live && setSearch({ kind: 'failed' }),
        ),
      300,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, hasPicks, reads])

  if (loaded.kind === 'loading') return <LoadingState label={messages.collections.loading} />
  if (loaded.kind === 'failed') return <ErrorState title={words.loadFailed.title} body={words.loadFailed.body} retry={{ label: messages.collections.error.retry, onRetry: () => setAttempt((a) => a + 1) }} />
  if (loaded.kind === 'missing')
    return (
      <section className="df-state" aria-labelledby={`${formId}-missing`}>
        <h2 id={`${formId}-missing`}>{words.notFound.title}</h2>
        <p>{words.notFound.body}</p>
        <Link className="df-button" to="/collections">
          {words.back}
        </Link>
      </section>
    )

  const ro = !canEdit || saving
  const set = (patch: Partial<CollectionDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const fields = blockFields(facets, draft.blocks)
  const nameMissing = draft.name.trim() === ''
  const parents = collections.filter((c) => c.id !== draft.id && (c.parentId === null || c.id === draft.parentId))
  const parent = collections.find((c) => c.id === draft.parentId) ?? null
  const slug = loaded.slug ?? (slugOf(draft.name) || words.slugPlaceholder)
  const handPicked = onlyPicks(draft.blocks)
  const count = preview.kind === 'ready' ? preview.preview.count : null
  const shown: Tile[] = preview.kind === 'ready' ? preview.preview.products.map((p) => ({ id: p.id, name: p.name, image: p.imageAssetId ? `/api/assets/${p.imageAssetId}` : null })) : []

  const held = collections.find((c) => c.id === draft.id)?.products ?? count ?? 0

  const save = async () => {
    if (nameMissing) {
      setTried(true)
      nameRef.current?.focus()
      return
    }
    setSaving(true)
    setFailure(null)
    try {
      await saveCollection(draft.id, draft.revision, {
        name: draft.name.trim(),
        description: draft.description,
        parentId: draft.parentId,
        inheritParent: draft.parentId !== null && draft.inheritParent,
        visible: draft.visible,
        imageAssetId: draft.imageAssetId,
        rules,
        ...draft.kept,
      })
      onDone(fill(handPicked ? words.saved : words.savedAuto, { name: draft.name.trim() }))
    } catch (error) {
      setFailure(refusalOf(error))
      setSaving(false)
    }
  }

  const remove = async () => {
    setAsking(false)
    if (!draft.id) return
    setSaving(true)
    try {
      await deleteCollection(draft.id)
      onDone(fill(words.deleted, { name: draft.name }))
    } catch (error) {
      setFailure(refusalOf(error))
      setSaving(false)
    }
  }

  const upload = (file: File) => {
    setUploading(true)
    setImageProblem(null)
    void uploadPhoto(file).then((result) => {
      setUploading(false)
      if (result.ok) set({ imageAssetId: result.assetId })
      else setImageProblem(words.imageRefused[result.code])
    })
  }

  const setBlock = (key: string, block: Block) => set({ blocks: draft.blocks.map((b) => (b.key === key ? block : b)) })
  const addBlock = (choice: string) => {
    if (choice === 'picks') return set({ blocks: [...draft.blocks, newBlock('picks')] })
    if (choice === nameField) return set({ blocks: [...draft.blocks, newBlock('name')] })
    set({ blocks: [...draft.blocks, newBlock('filter', choice)] })
  }
  const pickList = (block: Block) => (
    <div className="df-coll-picks">
      <input type="search" aria-label={words.search} placeholder={words.search} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="df-coll-picklist">
        {search.kind === 'loading' && <p className="df-coll-hint">{words.searching}</p>}
        {search.kind === 'failed' && (
          <p className="df-coll-problem" role="alert">
            {words.searchFailed}
          </p>
        )}
        {search.kind === 'ready' && search.rows.length === 0 && <p className="df-coll-hint">{fill(words.noProducts, { query: query.trim() })}</p>}
        {search.kind === 'ready' &&
          search.rows.map((p) => {
            const on = block.productIds.includes(p.id)
            return (
              <label key={p.id} className={on ? 'df-coll-pick df-coll-pick--on' : 'df-coll-pick'}>
                <input type="checkbox" checked={on} disabled={ro} onChange={() => setBlock(block.key, { ...block, productIds: on ? block.productIds.filter((x) => x !== p.id) : [...block.productIds, p.id] })} />
                <span>{p.name}</span>
                <span className="df-coll-hint">{p.approval === 'pending' ? words.statusWaiting : p.visible ? '' : words.statusHidden}</span>
              </label>
            )
          })}
      </div>
    </div>
  )

  return (
    <div className="df-coll-edit">
      <div className="df-coll-edit-main">
        <div className="df-coll-edit-head">
          <Link className="df-button" to="/collections">
            {words.back}
          </Link>
          <h1>{isNew ? words.newTitle : draft.name || words.untitled}</h1>
        </div>
        {failure && (
          <p className="df-coll-failure" role="alert">
            {failure}
          </p>
        )}
        <section className="df-coll-card">
          <div className="df-coll-field">
            <label htmlFor={`${formId}-name`}>{words.name}</label>
            <input
              ref={nameRef}
              id={`${formId}-name`}
              value={draft.name}
              readOnly={ro}
              maxLength={120}
              placeholder={words.namePlaceholder}
              aria-invalid={tried && nameMissing}
              aria-describedby={tried && nameMissing ? `${formId}-name-problem` : undefined}
              onChange={(e) => set({ name: e.target.value })}
            />
            {tried && nameMissing && (
              <span id={`${formId}-name-problem`} className="df-coll-problem">
                {words.nameMissing}
              </span>
            )}
          </div>
          <span className="df-coll-hint">{fill(words.addressNoDomain, { slug })}</span>
          <div className="df-coll-field">
            <label htmlFor={`${formId}-desc`}>
              {words.description} <span className="df-coll-hint">{words.descriptionHint}</span>
            </label>
            <textarea id={`${formId}-desc`} rows={2} value={draft.description} readOnly={ro} maxLength={5000} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <ImageField
            label={words.image}
            help={words.imageHint}
            alt={words.imageAlt}
            none={words.noImage}
            assetId={draft.imageAssetId}
            words={imageWords}
            readOnly={ro}
            busy={uploading}
            problem={imageProblem}
            onFile={upload}
            onRemove={() => {
              set({ imageAssetId: null })
              setImageProblem(null)
            }}
          />
        </section>

        <section className="df-coll-card" aria-labelledby={`${formId}-fill`}>
          <h2 id={`${formId}-fill`}>{words.fill}</h2>
          {parent && (
            <label className="df-coll-check">
              <input type="checkbox" checked={draft.inheritParent} disabled={ro} onChange={(e) => set({ inheritParent: e.target.checked })} />
              {fill(words.inherit, { name: parent.name })}
            </label>
          )}
          <div className="df-coll-rules">
            {draft.blocks.map((block, i) => (
              <div key={block.key}>
                {i > 0 && <JoinSwitch joiner={block.joiner} n={i} disabled={ro} onChange={(joiner) => setBlock(block.key, { ...block, joiner })} />}
                <div className="df-coll-block">
                  <div className="df-coll-block-head">
                    <strong>{block.kind === 'picks' ? words.blockPicks : block.kind === 'kept' ? words.blockKept : words.blockFilter}</strong>
                    {!ro && (
                      <button type="button" className="df-coll-rule-remove" aria-label={fill(words.removeBlock, { n: String(i + 1) })} onClick={() => set({ blocks: draft.blocks.filter((b) => b.key !== block.key) })}>
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </div>
                  <BlockBody block={block} n={i + 1} fields={fields} disabled={ro} onChange={(next) => setBlock(block.key, next)} picks={pickList(block)} />
                </div>
              </div>
            ))}
            {draft.blocks.length > 1 && <p className="df-coll-hint">{words.joinNote}</p>}
            {!ro && (
              <select className="df-coll-add" aria-label={words.addBlock} value="" onChange={(e) => addBlock(e.target.value)}>
                <option value="">{words.addBlock}</option>
                {!hasPicks && <option value="picks">{words.blockPicks}</option>}
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {fill(words.addFilterValues, { name: f.name })}
                  </option>
                ))}
                <option value={nameField}>{words.nameContains}</option>
              </select>
            )}
            <p className="df-coll-note">{pricingCurrency ? fill(words.priceNote, { currency: pricingCurrency }) : words.priceNoteNoCurrency}</p>
          </div>
        </section>

        <section className="df-coll-card" aria-labelledby={`${formId}-parent`}>
          <h2 id={`${formId}-parent`}>{words.parentTitle}</h2>
          <select aria-labelledby={`${formId}-parent`} value={draft.parentId ?? ''} disabled={ro} onChange={(e) => set({ parentId: e.target.value || null, inheritParent: e.target.value !== '' })}>
            <option value="">{words.topLevel}</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {fill(words.insideOption, { name: p.name })}
              </option>
            ))}
          </select>
          {parent && (
            <>
              <span className="df-coll-hint">{fill(words.flow, { parent: parent.name, parentCount: formatCount(parent.products), name: draft.name || words.untitled, count: count === null ? words.countPending : formatCount(count) })}</span>
            </>
          )}
        </section>

        <div className="df-coll-actions">
          <button type="button" role="switch" aria-checked={draft.visible} disabled={ro} className="df-switch df-coll-switch" onClick={() => set({ visible: !draft.visible })}>
            <span aria-hidden="true" />
            {draft.visible ? words.visible : words.hidden}
          </button>
          {canEdit && (
            <span>
              {!isNew && (
                <button type="button" className="df-button df-coll-delete" disabled={saving} onClick={() => setAsking(true)}>
                  {words.delete}
                </button>
              )}
              <button type="button" className="df-button df-button--primary" disabled={saving || uploading} onClick={() => void save()}>
                {saving ? words.saving : words.save}
              </button>
            </span>
          )}
        </div>
      </div>

      <aside className="df-coll-preview" aria-labelledby={`${formId}-preview`}>
        <div className="df-coll-preview-head">
          <h2 id={`${formId}-preview`}>{count === null ? words.preview : fill(plural(handPicked ? words.picked : words.matching, count), { count: formatCount(count) })}</h2>
          <span>{words.preview}</span>
        </div>
        {preview.kind === 'failed' && (
          <p className="df-coll-problem" role="alert">
            {words.previewFailed}
          </p>
        )}
        {preview.kind === 'loading' && <p className="df-coll-hint">{words.searching}</p>}
        {shown.length > 0 && (
          <ul className="df-coll-tiles">
            {shown.map((p) => (
              <li key={p.id}>
                {p.image ? <AssetImage url={p.image} alt="" className="df-coll-tile-image" placeholder="" /> : <span aria-hidden="true" />}
                <strong>{p.name}</strong>
              </li>
            ))}
          </ul>
        )}
        {count === 0 && <p className="df-coll-hint">{handPicked ? words.noPicks : words.noMatch}</p>}
      </aside>

      {asking && (
        <ConfirmDialog
          open
          danger
          title={fill(words.deleteTitle, { name: draft.name })}
          target={draft.name}
          consequence={[fill(plural(words.deleteBody, held), { count: formatCount(held) }), loaded.inMenu === false ? '' : loaded.inMenu ? words.deleteMenu : words.deleteMenuMaybe].filter(Boolean).join(' ')}
          confirmLabel={words.deleteConfirm}
          cancelLabel={words.cancel}
          onCancel={() => setAsking(false)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  )
}
