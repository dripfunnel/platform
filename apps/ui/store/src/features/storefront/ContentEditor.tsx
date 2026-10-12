import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, ErrorState, LoadingState } from '@dripfunnel/shared/ui'
import { useEffect, useId, useState } from 'react'
import { contentLimits, type ContentEntry, type ContentKind } from '../../api/content'
import { fill, formatTime, messages } from '../../messages'
import { refusalIn } from '../common/refusal'
import { ContentBlocks } from './ContentBlocks'
import { draftOf, draftProblem, inputOf, cleanSlug, pathOf, pathTakenText, slugShown, type ContentDraft } from './contentDraft'
import { counterText } from './seoView'
import type { StorefrontApi } from './storefrontApi'

const all = messages.storefront.content
const words = all.editor

type Read = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ready'; entry: ContentEntry | null }
type Problem = { field: 'title' | 'slug' | 'seo' | 'form'; text: string }

/** Search results cut a long title or description short; the preview does the same. */
const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 2)}…` : text)

export interface ContentEditorProps {
  kind: ContentKind
  /** Null for a page not saved yet. */
  id: string | null
  api: StorefrontApi
  canEdit: boolean
  host: string | null
  shopName: string
  contactEmail: string | null
  /** A page or post's title by its path, so a clash names it. */
  titleAt: (path: string) => string | null
  onBack: () => void
  onDone: (toast: string) => void
}

/** One page in StorefrontContent's editor: its words and blocks, how it looks in search, and Publishing. */
export const ContentEditor = ({ kind, id, api, canEdit, host, shopName, contactEmail, titleAt, onBack, onDone }: ContentEditorProps) => {
  const w = all.pages
  const formId = useId()
  const [read, setRead] = useState<Read>(id ? { kind: 'loading' } : { kind: 'ready', entry: null })
  const [draft, setDraft] = useState<ContentDraft>(() => draftOf(null))
  const [names, setNames] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState<'publish' | 'draft' | 'delete' | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [asking, setAsking] = useState(false)
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!id) return
    let live = true
    setRead({ kind: 'loading' })
    api.loadContentEntry(id).then(
      (entry) => {
        if (!live) return
        setRead(entry ? { kind: 'ready', entry } : { kind: 'missing' })
        if (!entry) return
        setDraft(draftOf(entry))
        const ids = [...new Set(entry.body.flatMap((b) => b.productIds ?? []))]
        api.loadProductNames(ids).then(
          (found) => live && setNames((was) => ({ ...found, ...was })),
          () => undefined,
        )
      },
      () => live && setRead({ kind: 'error' }),
    )
    return () => {
      live = false
    }
  }, [api, id, attempt])

  const back = (
    <button type="button" className="df-sf-link df-sfc-back" onClick={onBack}>
      ← {w.back}
    </button>
  )
  if (read.kind === 'loading') return <LoadingState label={words.loading} />
  if (read.kind === 'error') return <ErrorState title={all.error.title} body={all.error.body} retry={{ label: all.error.retry, onRetry: () => setAttempt((n) => n + 1) }} />
  if (read.kind === 'missing')
    return (
      <div className="df-sfc-editor">
        {back}
        <p className="df-sfc-empty">{w.notFound}</p>
      </div>
    )

  const { entry } = read
  const set = (patch: Partial<ContentDraft>) => {
    setDraft((was) => ({ ...was, ...patch }))
    setProblem(null)
  }
  const slug = slugShown(draft)
  const at = (field: Problem['field']) => (problem?.field === field ? problem.text : null)

  const save = async (publish: boolean) => {
    const early = draftProblem(draft)
    if (early) return setProblem(early)
    setBusy(publish ? 'publish' : 'draft')
    setProblem(null)
    try {
      await api.saveContent(kind, entry?.id ?? null, entry?.revision ?? null, inputOf(kind, draft, publish))
      onDone(publish ? words.published : words.savedDraft)
    } catch (error) {
      if (isApiError(error) && error.code === 'PATH_TAKEN') {
        const path = typeof error.details['path'] === 'string' ? error.details['path'] : pathOf(kind, slug)
        setProblem({ field: 'slug', text: pathTakenText({ path, heldBy: String(error.details['heldBy'] ?? '') }, titleAt) })
      } else if (isApiError(error) && error.code === 'INVALID_INPUT' && error.details['field'] === 'slug') setProblem({ field: 'slug', text: words.needsSlug })
      else setProblem({ field: 'form', text: refusalIn(words.refused)(error) })
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!entry) return
    setBusy('delete')
    setDeleteProblem(null)
    try {
      await api.deleteContent(kind, entry.id)
      setAsking(false)
      onDone(words.deleted)
    } catch (error) {
      setDeleteProblem(refusalIn(words.deleteRefused)(error))
      setBusy(null)
    }
  }

  const title = draft.title.trim() || w.untitled
  const status = all.status[entry?.status ?? 'draft']
  const counted = (key: 'seoTitle' | 'seoDescription') => (
    <span className={draft[key].length > contentLimits[key] ? 'df-sf-count df-sf-count--over' : 'df-sf-count'} id={`${formId}-${key}-count`}>
      {counterText(draft[key].length, contentLimits[key])}
    </span>
  )

  return (
    <div className="df-sfc-editor">
      {back}
      {problem?.field === 'form' && (
        <p className="df-sf-failure" role="alert">
          {problem.text}
        </p>
      )}
      <div className="df-sfc-columns">
        <div className="df-sfc-main">
          <section className="df-sf-card" aria-label={w.title}>
            <div className="df-sf-field">
              <label htmlFor={`${formId}-title`}>{words.title}</label>
              <input id={`${formId}-title`} className="df-sfc-title" value={draft.title} maxLength={contentLimits.title} readOnly={!canEdit} aria-invalid={at('title') ? true : undefined} aria-describedby={at('title') ? `${formId}-title-problem` : undefined} onChange={(e) => set({ title: e.target.value })} />
              {at('title') && (
                <span id={`${formId}-title-problem`} className="df-sf-problem" role="alert">
                  {at('title')}
                </span>
              )}
            </div>
            <div className="df-sf-field">
              <label htmlFor={`${formId}-slug`}>{words.slug}</label>
              <span className="df-sfc-slug" data-invalid={at('slug') ? 'true' : undefined}>
                <span className="df-sfc-prefix">{`${host ?? ''}${pathOf(kind, '')}`}</span>
                <input id={`${formId}-slug`} value={draft.slug} placeholder={slug} maxLength={contentLimits.slug} readOnly={!canEdit} aria-invalid={at('slug') ? true : undefined} aria-describedby={at('slug') ? `${formId}-slug-problem` : undefined} onChange={(e) => set({ slug: cleanSlug(e.target.value) })} />
              </span>
              {at('slug') && (
                <span id={`${formId}-slug-problem`} className="df-sf-problem" role="alert">
                  {at('slug')}
                </span>
              )}
            </div>
          </section>
          <ContentBlocks kind={kind} title={w.body} body={draft.body} onBody={(change) => {
              setDraft((was) => ({ ...was, body: change(was.body) }))
              setProblem(null)
            }} canEdit={canEdit} api={api} names={names} onName={(p, name) => setNames((was) => ({ ...was, [p]: name }))} contactEmail={contactEmail} />
          <section className="df-sf-card" aria-labelledby={`${formId}-search`}>
            <h2 id={`${formId}-search`}>{words.search}</h2>
            <div className="df-sf-field">
              <span className="df-sf-field-head">
                <label htmlFor={`${formId}-seo-title`}>{words.seoTitle}</label>
                {counted('seoTitle')}
              </span>
              <input id={`${formId}-seo-title`} value={draft.seoTitle} placeholder={title} readOnly={!canEdit} aria-invalid={draft.seoTitle.length > contentLimits.seoTitle || undefined} aria-describedby={`${formId}-seoTitle-count ${formId}-seo-help`} onChange={(e) => set({ seoTitle: e.target.value })} />
              <span id={`${formId}-seo-help`} className="df-sf-help">
                {words.seoTitleHelp}
              </span>
            </div>
            <div className="df-sf-field">
              <span className="df-sf-field-head">
                <label htmlFor={`${formId}-seo-description`}>{words.seoDescription}</label>
                {counted('seoDescription')}
              </span>
              <textarea id={`${formId}-seo-description`} rows={2} value={draft.seoDescription} readOnly={!canEdit} aria-invalid={draft.seoDescription.length > contentLimits.seoDescription || undefined} aria-describedby={`${formId}-seoDescription-count`} onChange={(e) => set({ seoDescription: e.target.value })} />
            </div>
            {at('seo') && (
              <span className="df-sf-problem" role="alert">
                {at('seo')}
              </span>
            )}
            <div className="df-sfc-google">
              <span className="df-sf-google-host">{`${host ?? ''}${pathOf(kind, slug || '…')}`}</span>
              <span className="df-sf-google-title">{cut(draft.seoTitle.trim() || `${title} · ${shopName}`, contentLimits.seoTitle)}</span>
              <span className="df-sf-google-text">{cut(draft.seoDescription.trim(), contentLimits.seoDescription) || words.seoPlaceholder}</span>
            </div>
          </section>
        </div>
        <aside className="df-sf-card df-sfc-side" aria-labelledby={`${formId}-publishing`}>
          <h2 id={`${formId}-publishing`}>{words.publishing}</h2>
          <span className="df-sfc-status">{entry ? fill(words.nowEdited, { status, date: formatTime(entry.updatedAt) }) : fill(words.now, { status })}</span>
          {entry?.waitingForPublish && <span className="df-sf-help">{words.waiting}</span>}
          <label className="df-sfc-check">
            <input type="checkbox" checked={draft.inMenu} disabled={!canEdit} onChange={() => set({ inMenu: !draft.inMenu })} />
            {words.inMenu}
          </label>
          {canEdit && (
            <>
              <button type="button" className="df-button df-button--primary" disabled={busy !== null} onClick={() => void save(true)}>
                {busy === 'publish' ? words.saving : entry?.status === 'published' ? words.update : words.publish}
              </button>
              <button type="button" className="df-button" disabled={busy !== null} onClick={() => void save(false)}>
                {busy === 'draft' ? words.saving : words.draft}
              </button>
            </>
          )}
          <span className="df-sf-help">{words.note}</span>
          {canEdit && entry && (
            <button type="button" className="df-sf-link df-sf-link--danger df-sfc-delete" disabled={busy !== null} onClick={() => setAsking(true)}>
              {w.delete}
            </button>
          )}
        </aside>
      </div>
      <ConfirmDialog
        open={asking}
        danger
        title={fill(w.deleteTitle, { title })}
        target={entry ? entry.path : ''}
        consequence={entry?.inMenu ? w.deleteBodyMenu : w.deleteBody}
        confirmLabel={w.delete}
        cancelLabel={words.cancel}
        error={deleteProblem}
        onCancel={() => {
          setAsking(false)
          setDeleteProblem(null)
        }}
        onConfirm={() => void remove()}
      />
    </div>
  )
}
