import { isApiError } from '@dripfunnel/shared/graphql'
import { useEffect, useId, useState } from 'react'
import { loadProductTranslation, saveProductTranslation, type ProductTranslationInput, type TranslationRow } from '../../api/translations'
import { fill, locale, messages } from '../../messages'
import { Card } from './EditorCards'

const words = messages.editor.translate

const names = new Intl.DisplayNames([locale], { type: 'language' })
/** "hi-IN" as people say it: Hindi (India). */
export const languageName = (code: string): string => names.of(code) ?? code

const keyOf = (r: Pick<TranslationRow, 'entity' | 'entityId' | 'field'>) => `${r.entity}|${r.entityId}|${r.field}`

/** What a save sends: only the fields typed differently from what is stored; empty clears one (fact 19). */
export const translationInputOf = (rows: readonly TranslationRow[], typed: Readonly<Record<string, string>>, supplier: boolean): ProductTranslationInput => {
  const changed = rows.filter((r) => typed[keyOf(r)] !== undefined && typed[keyOf(r)] !== (r.text ?? ''))
  const text = (r: TranslationRow) => (typed[keyOf(r)] ?? '').trim()
  const own = (field: TranslationRow['field']) => changed.find((r) => r.entity === 'product' && r.field === field)
  const input: ProductTranslationInput = {}
  for (const field of ['name', 'description', 'slug'] as const) {
    const row = own(field)
    if (row) input[field] = text(row)
  }
  const versions = changed.filter((r) => r.entity === 'version').map((r) => ({ id: r.entityId, name: text(r) }))
  if (versions.length > 0) input.versions = versions
  const shared = supplier ? [] : changed.flatMap((r) => (r.entity === 'option_name' || r.entity === 'choice_name' ? [{ kind: r.entity, source: r.entityId, text: text(r) }] : []))
  if (shared.length > 0) input.names = shared
  return input
}

/** The fields still to translate: missing, or changed in the main language since. */
export const todoCount = (rows: readonly TranslationRow[]): number => rows.filter((r) => r.status !== 'translated' && r.main.trim() !== '').length

const Row = ({ row, typed, onType, disabled, language, main }: { row: TranslationRow; typed: string; onType: (t: string) => void; disabled: boolean; language: string; main: string }) => {
  const id = useId()
  const long = row.field === 'description'
  const label = row.entity === 'product' ? words.fields[row.field] : row.main
  return (
    <div className={`df-editor-field df-editor-translation df-editor-translation--${row.status}`}>
      <label htmlFor={id}>
        {label} <span className="df-editor-hint-inline">· {row.status === 'changed' ? fill(words.status.changed, { language: main }) : words.status[row.status]}</span>
      </label>
      {row.entity === 'product' && <span className="df-editor-hint">{fill(words.mainText, { language: main, text: row.main || words.empty })}</span>}
      {long ? (
        <textarea id={id} rows={3} maxLength={20_000} placeholder={fill(words.placeholder, { language })} value={typed} readOnly={disabled} onChange={(e) => onType(e.target.value)} />
      ) : (
        <input id={id} maxLength={row.field === 'slug' ? 120 : 255} placeholder={fill(words.placeholder, { language })} value={typed} readOnly={disabled} onChange={(e) => onType(e.target.value)} />
      )}
      {row.field === 'slug' && <span className="df-editor-hint">{words.slugNote}</span>}
    </div>
  )
}

/**
 * The product in one of the store's other languages (CatEditor's translating view): each field beside the main
 * language's, saved by itself. Choice names are the whole catalogue's, so the merchant side's alone (N6, N15).
 */
export const TranslationView = ({ productId, language, mainLanguage, supplier, disabled, onSaved, onRows, onDirty }: { productId: string; language: string; mainLanguage: string; supplier: boolean; disabled: boolean; onSaved: (text: string) => void; onRows: (rows: TranslationRow[]) => void; onDirty: (dirty: boolean) => void }) => {
  const [rows, setRows] = useState<TranslationRow[] | 'failed' | null>(null)
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const lang = languageName(language)
  const main = languageName(mainLanguage)

  useEffect(() => {
    let live = true
    setRows(null)
    setTyped({})
    void loadProductTranslation(productId, language).then(
      (loaded) => {
        if (!live) return
        setRows(loaded)
        onRows(loaded)
      },
      () => live && setRows('failed'),
    )
    return () => {
      live = false
    }
  }, [productId, language, onRows])

  const input = Array.isArray(rows) ? translationInputOf(rows, typed, supplier) : {}
  const dirty = Object.keys(input).length > 0
  useEffect(() => onDirty(dirty), [dirty, onDirty])

  if (rows === null) return <p className="df-editor-hint">{words.loading}</p>
  if (rows === 'failed') return <p className="df-editor-problem">{words.failed}</p>

  const textOf = (r: TranslationRow) => typed[keyOf(r)] ?? r.text ?? ''
  const type = (r: TranslationRow) => (t: string) => {
    setTyped((x) => ({ ...x, [keyOf(r)]: t }))
    setProblem(null)
  }
  const save = async () => {
    setBusy(true)
    try {
      const stored = await saveProductTranslation(productId, language, input)
      setRows(stored)
      setTyped({})
      onRows(stored)
      onSaved(fill(words.saved, { language: lang }))
    } catch (error) {
      setProblem(isApiError(error) ? ((words.refused as Record<string, string>)[error.code] ?? words.refused.other) : words.refused.other)
    }
    setBusy(false)
  }
  const product = rows.filter((r) => r.entity === 'product')
  const versions = rows.filter((r) => r.entity === 'version')
  const shared = rows.filter((r) => r.entity === 'option_name' || r.entity === 'choice_name')
  const untouched = product.find((r) => r.field === 'name')?.status === 'missing'
  return (
    <>
      {untouched && (
        <div className="df-editor-banner df-editor-banner--info">
          <span>
            <strong>{fill(words.notYet, { language: lang })}</strong> {fill(words.notYetBody, { main })}
          </span>
        </div>
      )}
      <Card title={fill(words.title, { language: lang })} aside={<span className="df-editor-meter">{fill(words.clearHint, { main })}</span>}>
        {product.map((r) => (
          <Row key={keyOf(r)} row={r} typed={textOf(r)} onType={type(r)} disabled={disabled || busy} language={lang} main={main} />
        ))}
      </Card>
      {versions.length > 0 && (
        <Card title={words.versions}>
          {versions.map((r) => (
            <Row key={keyOf(r)} row={r} typed={textOf(r)} onType={type(r)} disabled={disabled || busy} language={lang} main={main} />
          ))}
        </Card>
      )}
      {shared.length > 0 && (
        <Card title={words.names} aside={<span className="df-editor-meter">{supplier ? words.namesSupplier : words.namesNote}</span>}>
          {shared.map((r) => (
            <Row key={keyOf(r)} row={r} typed={textOf(r)} onType={type(r)} disabled={disabled || busy || supplier} language={lang} main={main} />
          ))}
        </Card>
      )}
      <Card title={words.same}>
        <p className="df-editor-hint">{words.sameBody}</p>
      </Card>
      {problem && (
        <p className="df-editor-problem" role="alert">
          {problem}
        </p>
      )}
      {!disabled && (
        <div className="df-editor-translation-actions">
          <button type="button" className="df-button df-button--primary" disabled={busy || !dirty} onClick={() => void save()}>
            {words.save}
          </button>
        </div>
      )}
    </>
  )
}
