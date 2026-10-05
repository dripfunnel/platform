import { ConfirmDialog, ErrorState, Icon, LoadingState } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { deleteCollection, loadCollection, loadMembers, previewCollection, saveCollection, searchPickable, type Collection, type CollectionSummary, type Member, type Pickable, type Preview, type RuleInput } from '../../api/collections'
import { loadMenu } from '../../api/menu'
import type { Facet } from '../../api/productEditor'
import { fill, formatCount, messages, plural } from '../../messages'
import { RadioCards } from '../common/RadioCards'
import { blankDraft, draftOf, nameField, newRow, ruleFields, ruleInputs, slugOf, type CollectionDraft, type RuleRow } from './collectionDraft'
import { refusalIn } from '../common/refusal'

const words = messages.collections.editor

const refusalOf = refusalIn(messages.collections.refused)

type Loaded = { kind: 'loading' } | { kind: 'failed' } | { kind: 'missing' } | { kind: 'ready'; slug: string | null; inMenu: boolean | null }
type PreviewView = { kind: 'idle' } | { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; preview: Preview }
type Search = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; rows: Pickable[] }

/** What the editor reads: the API, or the ?state= harness's samples. */
export interface EditorReads {
  collection: (id: string) => Promise<Collection | null>
  members: (id: string) => Promise<Member[]>
  preview: (draft: { match: 'all' | 'any'; rules: RuleInput[]; parentId: string | null; inheritParent: boolean }) => Promise<Preview>
  search: (query: string) => Promise<Pickable[]>
}

const apiReads: EditorReads = { collection: loadCollection, members: loadMembers, preview: previewCollection, search: searchPickable }

export interface CollectionEditorProps {
  /** A collection's id, or `new`. */
  id: string
  /** A new collection's name from a seasonal suggestion: picked by hand, as the prototype starts one. */
  suggested: string | null
  facets: readonly Facet[]
  collections: readonly CollectionSummary[]
  pricingCurrency: string | null
  canEdit: boolean
  onDone: (toast: string) => void
  reads?: EditorReads
}

const RuleSentence = ({ row, n, join, fields, disabled, onChange, onRemove }: { row: RuleRow; n: number; join: string; fields: readonly Facet[]; disabled: boolean; onChange: (row: RuleRow) => void; onRemove: (() => void) | null }) => {
  const facet = fields.find((f) => f.id === row.field)
  return (
    <div className="df-coll-rule">
      <span className="df-coll-rule-join">{join}</span>
      <select aria-label={fill(words.field, { n: String(n) })} value={row.field} disabled={disabled} onChange={(e) => onChange({ ...row, field: e.target.value, values: [], text: '' })}>
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
        <option value={nameField}>{words.nameContains}</option>
      </select>
      {row.field === nameField ? (
        <input aria-label={fill(words.text, { n: String(n) })} value={row.text} readOnly={disabled} placeholder={words.textPlaceholder} maxLength={60} onChange={(e) => onChange({ ...row, text: e.target.value })} />
      ) : (
        <>
          <span>{words.is}</span>
          {facet?.values.map((v) => {
            const on = row.values.includes(v.id)
            return (
              <button key={v.id} type="button" className="df-coll-chip" aria-pressed={on} disabled={disabled} onClick={() => onChange({ ...row, values: on ? row.values.filter((x) => x !== v.id) : [...row.values, v.id] })}>
                {v.name}
              </button>
            )
          })}
        </>
      )}
      {onRemove && (
        <button type="button" className="df-coll-rule-remove" aria-label={fill(words.removeRule, { n: String(n) })} onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  )
}

/** CatCollections' editor: name, how it fills (rules or picks), its parent, visibility, and the live preview beside them. */
export const CollectionEditor = ({ id, suggested, facets, collections, pricingCurrency, canEdit, onDone, reads = apiReads }: CollectionEditorProps) => {
  const isNew = id === 'new'
  const formId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState<Loaded>(isNew ? { kind: 'ready', slug: null, inMenu: false } : { kind: 'loading' })
  const [draft, setDraft] = useState<CollectionDraft>(() => (isNew ? { ...blankDraft(facets), ...(suggested ? { name: suggested, kind: 'manual' as const } : {}) } : blankDraft(facets)))
  const [names, setNames] = useState<Record<string, string>>({})
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
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
        const [members, menu] = await Promise.all([c.kind === 'manual' ? reads.members(c.id) : Promise.resolve([]), loadMenu().catch(() => undefined)])
        if (!live) return
        setNames(Object.fromEntries(members.map((m) => [m.id, m.name])))
        setDraft(draftOf(c, facets, members.map((m) => m.id)))
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

  const rules = ruleInputs(draft)
  const rulesKey = JSON.stringify([draft.kind, draft.match, rules, draft.parentId, draft.inheritParent])
  useEffect(() => {
    if (loaded.kind !== 'ready' || draft.kind !== 'automatic') return setPreview({ kind: 'idle' })
    let live = true
    setPreview({ kind: 'loading' })
    const timer = setTimeout(
      () =>
        void reads.preview({ match: draft.match, rules, parentId: draft.parentId, inheritParent: draft.inheritParent }).then(
          (p) => live && setPreview({ kind: 'ready', preview: p }),
          () => live && setPreview({ kind: 'failed' }),
        ),
      300,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
    // rulesKey stands for the rules, match and parent, which are rebuilt each render.
  }, [rulesKey, loaded.kind, reads])

  useEffect(() => {
    if (draft.kind !== 'manual') return
    let live = true
    setSearch({ kind: 'loading' })
    const timer = setTimeout(
      () =>
        void reads.search(query.trim()).then(
          (rows) => {
            if (!live) return
            setSearch({ kind: 'ready', rows })
            setNames((n) => ({ ...n, ...Object.fromEntries(rows.map((r) => [r.id, r.name])) }))
          },
          () => live && setSearch({ kind: 'failed' }),
        ),
      300,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, draft.kind, reads])

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
  const fields = ruleFields(facets, draft.rows)
  const nameMissing = draft.name.trim() === ''
  const parents = collections.filter((c) => c.id !== draft.id && (c.parentId === null || c.id === draft.parentId))
  const parent = collections.find((c) => c.id === draft.parentId) ?? null
  const slug = loaded.slug ?? (slugOf(draft.name) || words.slugPlaceholder)
  const count = draft.kind === 'manual' ? draft.productIds.length : preview.kind === 'ready' ? preview.preview.count : null
  const shown = draft.kind === 'manual' ? draft.productIds.slice(0, 6).map((p) => ({ id: p, name: names[p] ?? '' })) : preview.kind === 'ready' ? preview.preview.products : []

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
        kind: draft.kind,
        match: draft.match,
        parentId: draft.parentId,
        inheritParent: draft.parentId !== null && draft.inheritParent,
        visible: draft.visible,
        rules: draft.kind === 'automatic' ? rules : [],
        productIds: draft.kind === 'manual' ? draft.productIds : [],
        ...draft.kept,
      })
      onDone(fill(draft.kind === 'automatic' ? words.savedAuto : words.saved, { name: draft.name.trim() }))
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

  const setRow = (key: string, row: RuleRow) => set({ rows: draft.rows.map((r) => (r.key === key ? row : r)) })
  const join = (i: number) => (i === 0 ? words.where : draft.match === 'any' ? words.or : words.and)

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
        </section>

        <section className="df-coll-card" aria-labelledby={`${formId}-fill`}>
          <h2 id={`${formId}-fill`}>{words.fill}</h2>
          <RadioCards
            labelledBy={`${formId}-fill`}
            value={draft.kind}
            disabled={ro}
            onChange={(kind) => set({ kind })}
            options={[
              { value: 'automatic', label: words.automatic, sub: words.automaticSub },
              { value: 'manual', label: words.manual, sub: words.manualSub },
            ]}
          />
          {draft.kind === 'automatic' ? (
            <div className="df-coll-rules">
              <label className="df-coll-match">
                <span>{words.matchLead}</span>
                <select value={draft.match} disabled={ro} onChange={(e) => set({ match: e.target.value === 'any' ? 'any' : 'all' })}>
                  <option value="all">{words.matchAll}</option>
                  <option value="any">{words.matchAny}</option>
                </select>
              </label>
              {draft.rows.map((row, i) => (
                <RuleSentence key={row.key} row={row} n={i + 1} join={join(i)} fields={fields} disabled={ro} onChange={(next) => setRow(row.key, next)} onRemove={ro ? null : () => set({ rows: draft.rows.filter((r) => r.key !== row.key) })} />
              ))}
              {draft.others.length > 0 && <p className="df-coll-hint">{fill(plural(words.kept, draft.others.length), { count: formatCount(draft.others.length) })}</p>}
              {!ro && (
                <button type="button" className="df-coll-link" onClick={() => set({ rows: [...draft.rows, newRow(fields[1]?.id ?? fields[0]?.id ?? nameField)] })}>
                  {words.addRule}
                </button>
              )}
              <p className="df-coll-note">{pricingCurrency ? fill(words.priceNote, { currency: pricingCurrency }) : words.priceNoteNoCurrency}</p>
            </div>
          ) : (
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
                    const on = draft.productIds.includes(p.id)
                    return (
                      <label key={p.id} className={on ? 'df-coll-pick df-coll-pick--on' : 'df-coll-pick'}>
                        <input type="checkbox" checked={on} disabled={ro} onChange={() => set({ productIds: on ? draft.productIds.filter((x) => x !== p.id) : [...draft.productIds, p.id] })} />
                        <span>{p.name}</span>
                        <span className="df-coll-hint">{p.approval === 'pending' ? words.statusWaiting : p.visible ? '' : words.statusHidden}</span>
                      </label>
                    )
                  })}
              </div>
            </div>
          )}
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
              <label className="df-coll-check">
                <input type="checkbox" checked={draft.inheritParent} disabled={ro} onChange={(e) => set({ inheritParent: e.target.checked })} />
                {fill(words.inherit, { name: parent.name })}
              </label>
              <span className="df-coll-hint">{fill(words.flow, { parent: parent.name, parentCount: formatCount(parent.products), name: draft.name || words.untitled, count: count === null ? words.countPending : formatCount(count) })}</span>
            </>
          )}
        </section>

        <div className="df-coll-actions">
          <button type="button" role="switch" aria-checked={draft.visible} disabled={ro} className="df-coll-switch" onClick={() => set({ visible: !draft.visible })}>
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
              <button type="button" className="df-button df-button--primary" disabled={saving} onClick={() => void save()}>
                {saving ? words.saving : words.save}
              </button>
            </span>
          )}
        </div>
      </div>

      <aside className="df-coll-preview" aria-labelledby={`${formId}-preview`}>
        <div className="df-coll-preview-head">
          <h2 id={`${formId}-preview`}>{count === null ? words.preview : fill(plural(draft.kind === 'manual' ? words.picked : words.matching, count), { count: formatCount(count) })}</h2>
          <span>{words.preview}</span>
        </div>
        {preview.kind === 'failed' && draft.kind === 'automatic' && (
          <p className="df-coll-problem" role="alert">
            {words.previewFailed}
          </p>
        )}
        {preview.kind === 'loading' && draft.kind === 'automatic' && <p className="df-coll-hint">{words.searching}</p>}
        {shown.length > 0 && (
          <ul className="df-coll-tiles">
            {shown.map((p) => (
              <li key={p.id}>
                <span aria-hidden="true" />
                <strong>{p.name}</strong>
              </li>
            ))}
          </ul>
        )}
        {count === 0 && <p className="df-coll-hint">{draft.kind === 'manual' ? words.noPicks : words.noMatch}</p>}
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
