import { useEffect, useId, useRef, useState } from 'react'
import { fill, locale, messages } from '../../messages'
import { editRefusal, languageName } from './studioView'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.studio.edit

export interface EditTextDialogProps {
  /** The words picked in the frame, as their key (`pages:home.lead`), or null while closed. */
  textKey: string | null
  page: string
  pageLabel: string
  /** The store's languages, the main one first. */
  languages: readonly string[]
  api: StorefrontApi
  onCancel: () => void
  onNotHere: () => void
  onSaved: () => void
}

type Loaded = { kind: 'loading' } | { kind: 'ready'; was: Record<string, string>; now: Record<string, string> }

/** Edit text (FIRST-RELEASE §14): the picked words in every language the store offers, saved through the same checks as any change. */
export const EditTextDialog = ({ textKey, page, pageLabel, languages, api, onCancel, onNotHere, onSaved }: EditTextDialogProps) => {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const main = languages[0] ?? locale

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (textKey && !dialog.open) dialog.showModal()
    else if (!textKey && dialog.open) dialog.close()
  }, [textKey])

  useEffect(() => {
    setError(null)
    setLoaded({ kind: 'loading' })
    if (!textKey) return
    let current = true
    Promise.all(languages.map((l) => api.loadDesignText(page, l).then((list) => [l, list.find((t) => t.key === textKey)?.text ?? ''] as const))).then(
      (pairs) => {
        if (!current) return
        const was = Object.fromEntries(pairs)
        if (!was[main]) return onNotHere()
        setLoaded({ kind: 'ready', was, now: was })
      },
      (e: unknown) => current && setError(editRefusal(e)),
    )
    return () => {
      current = false
    }
  }, [textKey, page, languages, main, api, onNotHere])

  const save = async () => {
    if (loaded.kind !== 'ready' || saving || !textKey) return
    if (!loaded.now[main]?.trim()) return setError(fill(words.mainMissing, { language: languageName(main, locale) }))
    setSaving(true)
    setError(null)
    try {
      for (const l of languages) {
        const text = loaded.now[l]?.trim() ?? ''
        if (text !== '' && text !== loaded.was[l]) await api.saveDesignText(l, textKey, text)
      }
      onSaved()
    } catch (e) {
      setError(editRefusal(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="df-dialog df-studio-edit"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <h2 id={titleId}>{words.title}</h2>
      <p className="df-sf-lede">{fill(words.where, { page: pageLabel })}</p>
      {loaded.kind === 'ready' &&
        languages.map((l) => {
          const value = loaded.now[l] ?? ''
          const name = languageName(l, locale)
          return (
            <label key={l} className="df-field">
              <span>{l === main ? fill(words.main, { language: name }) : name}</span>
              <textarea rows={2} value={value} onChange={(e) => (setError(null), setLoaded({ ...loaded, now: { ...loaded.now, [l]: e.target.value } }))} />
              {l !== main && !value.trim() && <span className="df-field-hint">{fill(words.untranslated, { main: languageName(main, locale) })}</span>}
            </label>
          )
        })}
      {error && (
        <p className="df-sf-problem" role="alert">
          {error}
        </p>
      )}
      <div className="df-actions">
        <button type="button" className="df-button" onClick={onCancel}>
          {words.cancel}
        </button>
        <button type="button" className="df-button df-button--primary" disabled={loaded.kind !== 'ready' || saving} onClick={() => void save()}>
          {saving ? words.saving : words.save}
        </button>
      </div>
    </dialog>
  )
}
