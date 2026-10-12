import { ConfirmDialog, ErrorState, LoadingState } from '@dripfunnel/shared/ui'
import { useEffect, useId, useState } from 'react'
import { contentLimits, type ContentEntry, type ContentKind } from '../../api/content'
import { fill, messages } from '../../messages'
import { languageName } from '../common/languageName'
import { refusalIn } from '../common/refusal'
import { translationDraftOf, translationInputOf, writtenOf, type TranslatedBlock, type TranslationDraft } from './contentTranslation'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.content.translate
const kinds = messages.storefront.content.editor.kinds

/** `written` once the language has words of its own; `changed` once the main language's moved since. */
type Read = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; written: boolean; changed: boolean }

export interface TranslationPanelProps {
  kind: ContentKind
  entry: ContentEntry
  language: string
  mainLanguage: string
  canEdit: boolean
  api: StorefrontApi
  /** True while typed words aren't saved, so the language tabs hold still. */
  onDirty: (dirty: boolean) => void
  onToast: (text: string) => void
}

/** A page or post in another language the store offers: its title, each block's words and search words. */
export const TranslationPanel = ({ kind, entry, language, mainLanguage, canEdit, api, onDirty, onToast }: TranslationPanelProps) => {
  const id = useId()
  const [read, setRead] = useState<Read>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [saved, setSaved] = useState<TranslationDraft>(() => translationDraftOf(entry, null))
  const [draft, setDraft] = useState<TranslationDraft>(saved)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const lang = languageName(language)
  const main = languageName(mainLanguage)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  useEffect(() => {
    let live = true
    setRead({ kind: 'loading' })
    api.loadContentTranslation(entry.id, language).then(
      (written) => {
        if (!live) return
        const loaded = translationDraftOf(entry, written)
        setSaved(loaded)
        setDraft(loaded)
        setRead({ kind: 'ready', written: written !== null, changed: written?.changed ?? false })
      },
      () => live && setRead({ kind: 'error' }),
    )
    return () => {
      live = false
    }
  }, [api, entry, language, attempt])
  useEffect(() => onDirty(dirty), [dirty, onDirty])

  if (read.kind === 'loading') return <LoadingState label={words.loading} />
  if (read.kind === 'error') return <ErrorState title={words.failed} body={words.failedBody} retry={{ label: words.retry, onRetry: () => setAttempt((n) => n + 1) }} />

  const write = async (remove: boolean) => {
    setBusy(true)
    setProblem(null)
    try {
      const input = remove ? null : translationInputOf(entry, draft)
      await api.saveContentTranslation(kind, entry.id, language, input)
      const next = translationDraftOf(entry, input ? writtenOf(language, input) : null)
      setSaved(next)
      setDraft(next)
      setRead({ kind: 'ready', written: !remove, changed: false })
      setAsking(false)
      onToast(fill(remove ? words.removed : words.saved, { language: lang }))
    } catch (error) {
      setProblem(refusalIn(words.refused)(error))
    } finally {
      setBusy(false)
    }
  }
  const setBlock = (index: number, patch: Partial<TranslatedBlock>) => setDraft((was) => ({ ...was, blocks: was.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)) }))
  const hint = (text: string | null | undefined) => (text ? fill(words.main, { language: main, text }) : undefined)
  const field = (key: string, label: string, value: string, mainText: string | null | undefined, onValue: (v: string) => void, max: number, multiline = false) => (
    <div className="df-sf-field" key={key}>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      {multiline ? (
        <textarea id={`${id}-${key}`} rows={3} value={value} maxLength={max} readOnly={!canEdit} placeholder={mainText ?? ''} aria-describedby={`${id}-${key}-main`} onChange={(e) => onValue(e.target.value)} />
      ) : (
        <input id={`${id}-${key}`} value={value} maxLength={max} readOnly={!canEdit} placeholder={mainText ?? ''} aria-describedby={`${id}-${key}-main`} onChange={(e) => onValue(e.target.value)} />
      )}
      <span id={`${id}-${key}-main`} className="df-sf-help">
        {hint(mainText)}
      </span>
    </div>
  )

  return (
    <div className="df-sfc-main">
      <section className="df-sf-card" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{fill(words.title, { language: lang })}</h2>
        <p className="df-sf-help">{read.written ? (read.changed ? fill(words.changed, { main }) : fill(words.hint, { main })) : fill(words.notYet, { language: lang, main })}</p>
        {problem && (
          <p className="df-sf-failure" role="alert">
            {problem}
          </p>
        )}
        {field('title', words.fields.title, draft.title, entry.title, (title) => setDraft((was) => ({ ...was, title })), contentLimits.title)}
      </section>
      <section className="df-sf-card" aria-label={words.blocks}>
        {entry.body.map((b, i) => {
          const t = draft.blocks[i]
          const number = String(i + 1)
          return (
            <div key={i} className="df-sfc-block" role="group" aria-label={fill(messages.storefront.content.editor.blockText, { kind: kinds[b.kind], number })}>
              <span className="df-sfc-kind">{kinds[b.kind]}</span>
              {(b.kind === 'heading' || b.kind === 'text') && field(`b${i}`, fill(words.fields.block, { kind: kinds[b.kind], number }), t?.text ?? '', b.text, (text) => setBlock(i, { text }), b.kind === 'heading' ? contentLimits.heading : contentLimits.text, b.kind === 'text')}
              {b.kind === 'image' && field(`b${i}`, fill(messages.storefront.content.editor.photoAlt, { number }), t?.alt ?? '', b.alt, (alt) => setBlock(i, { alt }), contentLimits.alt)}
              {b.kind === 'faq' &&
                (b.items ?? []).map((q, n) => {
                  const at = String(n + 1)
                  const item = t?.items[n] ?? { question: '', answer: '' }
                  const change = (patch: Partial<typeof item>) => setBlock(i, { items: (t?.items ?? []).map((x, m) => (m === n ? { ...x, ...patch } : x)) })
                  return [
                    field(`b${i}q${n}`, fill(messages.storefront.content.editor.question, { number: at }), item.question, q.question, (question) => change({ question }), contentLimits.question),
                    field(`b${i}a${n}`, fill(messages.storefront.content.editor.answer, { number: at }), item.answer, q.answer, (answer) => change({ answer }), contentLimits.answer, true),
                  ]
                })}
              {(b.kind === 'products' || b.kind === 'form') && <span className="df-sf-help">{words.same}</span>}
            </div>
          )
        })}
      </section>
      <section className="df-sf-card" aria-labelledby={`${id}-search`}>
        <h2 id={`${id}-search`}>{messages.storefront.content.editor.search}</h2>
        {field('seo-title', words.fields.seoTitle, draft.seoTitle, entry.seoTitle, (seoTitle) => setDraft((was) => ({ ...was, seoTitle })), contentLimits.seoTitle)}
        {field('seo-description', words.fields.seoDescription, draft.seoDescription, entry.seoDescription, (seoDescription) => setDraft((was) => ({ ...was, seoDescription })), contentLimits.seoDescription, true)}
      </section>
      {canEdit && (
        <div className="df-sf-actions">
          {read.written && (
            <button type="button" className="df-sf-link df-sf-link--danger" disabled={busy} onClick={() => setAsking(true)}>
              {fill(words.remove, { language: lang })}
            </button>
          )}
          {dirty && (
            <button type="button" className="df-button" disabled={busy} onClick={() => setDraft(saved)}>
              {words.cancel}
            </button>
          )}
          <button type="button" className="df-button df-button--primary" disabled={busy || !dirty} onClick={() => void write(false)}>
            {busy ? words.saving : words.save}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={asking}
        danger
        title={fill(words.removeTitle, { language: lang })}
        target={entry.title}
        consequence={fill(words.removeBody, { language: lang, main })}
        confirmLabel={words.removeConfirm}
        cancelLabel={words.cancel}
        error={asking ? problem : null}
        onCancel={() => setAsking(false)}
        onConfirm={() => void write(true)}
      />
    </div>
  )
}
