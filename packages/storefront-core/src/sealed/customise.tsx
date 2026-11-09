'use client'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { useCart, type GiftRecipient } from '../cart/cart'
import { removeAnswerFile, uploadAnswerFile } from '../cart/uploads'
import type { AnswerProblem } from '../platform/api/client'
import { navigate } from '../platform/browser/router'
import { useStorefront } from '../platform/store/context'
import { formatMoney, moneySchema, type Money } from '../pricing/money'
import { moneyFields } from '../products/summary'
import { askedFor, answersToSend, type Answer, type ExtraPrice, type Question } from '../products/questions'
import { focusedElement } from './element'
import { Sealed } from './Sealed'

// The customisation modal (storefront ARCHITECTURE §3.5; CATALOG-DESIGN §3 facts 49–57): a sealed <dialog> in the top layer.
// Every amount is the Shop API's (`customisationQuote`); nothing here prices anything. Loaded only for a product with questions.

export type CustomiseIntent = { kind: 'add' } | { kind: 'buy' } | { kind: 'edit'; lineId: string }

export type CustomiseProps = {
  product: { name: string; questions: readonly Question[] }
  versionId: string
  quantity: number
  /** The line's answers when editing; empty when adding. */
  initial: readonly Answer[]
  intent: CustomiseIntent
  /** A gift card's recipient, which the engine needs to sell one. */
  gift?: GiftRecipient | null | undefined
  /** Closed: `done` is true once the cart took the answers. */
  onClose: (done: boolean) => void
}

const quoteQuery = `query Quote($versionId: ID!, $quantity: Int!, $answers: [ShopAnswerInput!]!) { customisationQuote(versionId: $versionId, quantity: $quantity, answers: $answers) { unitPrice { ${moneyFields} } lineTotal { ${moneyFields} } problems { questionId choiceId reason } } }`
const quoteSchema = z.object({
  customisationQuote: z
    .object({
      unitPrice: moneySchema.nullable().optional(),
      lineTotal: moneySchema.nullable().optional(),
      problems: z.array(z.object({ questionId: z.string().nullable().optional(), choiceId: z.string().nullable().optional(), reason: z.string() })).nullable().optional(),
    })
    .nullable(),
})

type Quote = { lineTotal: Money | null; problems: AnswerProblem[] }
type FileState = { key: string; name: string; id: string | null; percent: number; failed: string | null }

const problemKeys = ['REQUIRED', 'TOO_FEW_PICKS', 'TOO_MANY_PICKS', 'QUANTITY_TOO_HIGH', 'CHOICE_UNAVAILABLE', 'TEXT_TOO_LONG', 'TOO_MANY_FILES', 'UPLOAD_NOT_FOUND']
const refusalKeys = ['FILE_TYPE', 'FILE_TOO_LARGE', 'TOO_MANY_UPLOADS', 'RATE_LIMITED', 'UPLOAD_IN_USE', 'ONE_LINE_PER_VERSION']
const acceptOf = (q: Question) => (q.accept === 'PDF' ? 'application/pdf' : q.accept === 'IMAGE_PDF' ? 'image/*,application/pdf' : 'image/*')

export const CustomiseModal = ({ product, versionId, quantity, initial, intent, gift, onClose }: CustomiseProps) => {
  const { client, locale, t } = useStorefront()
  const cart = useCart()
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<Element | null>(null)
  const titleId = useId()
  const [answers, setAnswers] = useState<Answer[]>(() => initial.map((a) => ({ ...a })))
  const [files, setFiles] = useState<Record<string, FileState[]>>(() =>
    Object.fromEntries(initial.filter((a) => a.uploadIds && a.uploadIds.length > 0).map((a) => [a.questionId, (a.uploadIds ?? []).map((id, i) => ({ key: id, name: t('customise.file', { number: i + 1 }), id, percent: 1, failed: null }))])),
  )
  const [quote, setQuote] = useState<Quote | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const money = (m: Money) => formatMoney(m, locale)

  // Focus goes back to what opened it once the modal goes (WCAG 2.2).
  useLayoutEffect(() => {
    opener.current = focusedElement(document)
    return () => {
      const back = opener.current
      if (back instanceof HTMLElement) back.focus()
    }
  }, [])
  // Opens in the top layer, which traps focus and closes on Escape. A ref callback, since Sealed moves its children into
  // the closed root after the first render, and the dialog element there is a new one.
  const openDialog = (el: HTMLDialogElement | null) => {
    dialog.current = el
    if (el && !el.open && el.isConnected && typeof el.showModal === 'function') el.showModal()
  }

  const answerOf = (id: string) => answers.find((a) => a.questionId === id)
  const set = (questionId: string, patch: Omit<Answer, 'questionId'>) =>
    setAnswers((list) => [...list.filter((a) => a.questionId !== questionId), { questionId, ...patch }])
  const asked = useMemo(() => askedFor(product.questions, versionId, answers), [product.questions, versionId, answers])
  const sent = useMemo(() => answersToSend(product.questions, versionId, answers), [product.questions, versionId, answers])

  // The live total: the newest answer wins, a moment after the last change.
  const asks = useRef(0)
  const askQuote = async (answersNow: readonly Answer[]): Promise<Quote> => {
    const { customisationQuote: q } = await client.query(quoteQuery, quoteSchema, { versionId, quantity, answers: answersNow })
    return { lineTotal: q?.lineTotal ?? null, problems: (q?.problems ?? []).map((p) => ({ questionId: p.questionId ?? null, choiceId: p.choiceId ?? null, reason: p.reason })) }
  }
  useEffect(() => {
    const n = (asks.current += 1)
    const timer = setTimeout(() => {
      askQuote(sent).then(
        (q) => n === asks.current && setQuote(q),
        () => n === asks.current && setQuote(null),
      )
    }, 250)
    return () => clearTimeout(timer)
  }, [client, versionId, quantity, sent])

  const problemOf = (q: Question) => (showProblems ? quote?.problems.find((p) => p.questionId === q.id) : undefined)
  const problemText = (p: AnswerProblem) => t(problemKeys.includes(p.reason) ? `customise.problem.${p.reason}` : 'customise.problem.other')
  const extraText = (price: ExtraPrice | null) => {
    if (!price) return null
    if (price.mode === 'PERCENT') return price.percentBps === null ? null : t('customise.extraPercent', { percent: price.percentBps / 100 })
    if (!price.amount) return t('customise.unavailable')
    return price.mode === 'PER_CHARACTER' ? t('customise.extraPerCharacter', { price: money(price.amount) }) : t('customise.extra', { price: money(price.amount) })
  }

  // Files this session uploaded: kept only when the answers are; Cancel or Escape takes them back, so none is left to count.
  const uploadedHere = useRef(new Set<string>())
  const closed = useRef(false)
  const close = (done: boolean) => {
    closed.current = true
    dialog.current?.close()
    if (!done) for (const id of uploadedHere.current) void removeAnswerFile(client, id)
    onClose(done)
  }

  // Rows the shopper removed while their file was still going up: its answer is never kept, and the file is taken back.
  const dropped = useRef(new Set<string>())
  const upload = (q: Question, file: File) => {
    const key = `${q.id}-${Date.now()}-${file.name}`
    const row: FileState = { key, name: file.name, id: null, percent: 0, failed: null }
    setFiles((all) => ({ ...all, [q.id]: [...(all[q.id] ?? []), row] }))
    const patch = (change: Partial<FileState>) => setFiles((all) => ({ ...all, [q.id]: (all[q.id] ?? []).map((f) => (f.key === key ? { ...f, ...change } : f)) }))
    void uploadAnswerFile(client, q.id, file, (sentShare) => patch({ percent: sentShare })).then((result) => {
      if (!result.ok) return patch({ failed: refusalKeys.includes(result.code) ? `customise.refused.${result.code}` : 'customise.refused.other' })
      // Removed, or the modal closed without saving, while it was going up: never kept, taken back.
      if (dropped.current.has(key) || closed.current) return void removeAnswerFile(client, result.id)
      uploadedHere.current.add(result.id)
      patch({ id: result.id, percent: 1 })
      setAnswers((list) => {
        const was = list.find((a) => a.questionId === q.id)?.uploadIds ?? []
        return [...list.filter((a) => a.questionId !== q.id), { questionId: q.id, uploadIds: [...was, result.id] }]
      })
    })
  }
  const removeFile = (q: Question, f: FileState) => {
    setFiles((all) => ({ ...all, [q.id]: (all[q.id] ?? []).filter((x) => x.key !== f.key) }))
    if (!f.id) {
      dropped.current.add(f.key)
      return
    }
    const id = f.id
    setAnswers((list) => list.map((a) => (a.questionId === q.id ? { ...a, uploadIds: (a.uploadIds ?? []).filter((u) => u !== id) } : a)))
    // A file no line names yet goes at once; one a line holds stays until that line's answers change (UPLOAD_IN_USE).
    void removeAnswerFile(client, id)
  }

  const confirm = async () => {
    setShowProblems(true)
    setError(null)
    setBusy(true)
    // Decided on a quote of exactly these answers, asked now: the live one may be late or missing.
    asks.current += 1
    const fresh = await askQuote(sent).catch(() => null)
    setQuote(fresh)
    if (!fresh || fresh.problems.length > 0) {
      setBusy(false)
      if (!fresh) setError(t('customise.failed'))
      return
    }
    const refused = intent.kind === 'edit' ? await cart.editAnswers(intent.lineId, sent) : await cart.addWithAnswers(versionId, quantity, sent, gift ?? undefined)
    setBusy(false)
    if (refused) {
      setError(t(refusalKeys.includes(refused) ? `customise.refused.${refused}` : 'customise.failed'))
      return
    }
    close(true)
    if (intent.kind === 'buy') navigate('/checkout/')
  }

  return (
    <Sealed part="customise">
      <dialog
        ref={openDialog}
        part="dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault()
          // Not while the cart is taking the answers: its files may be the new line's.
          if (!busy) close(false)
        }}
      >
        <form
          part="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void confirm()
          }}
        >
          <h2 id={titleId} part="title">
            {t(intent.kind === 'edit' ? 'customise.editTitle' : 'customise.title', { name: product.name })}
          </h2>
          {asked.map((q) => {
            const problem = problemOf(q)
            const describedBy = `${titleId}-${q.id}-about`
            const a = answerOf(q.id)
            // On each control, where assistive tech reads it; a fieldset takes no aria-invalid (WCAG 2.2, 3.3.1).
            const invalid = { 'aria-invalid': problem ? true : undefined, 'aria-describedby': describedBy }
            return (
              <fieldset key={q.id} part="question" aria-describedby={describedBy}>
                <legend part="label">
                  {q.label} <span part="rule">({t(q.required || q.minPicks > 0 ? 'customise.required' : 'customise.optional')})</span>
                </legend>
                <div id={describedBy}>
                  {q.help && <p part="hint">{q.help}</p>}
                  {q.kind === 'CHOICE' && q.maxPicks > 1 && <p part="rule">{t('customise.pickUpTo', { count: q.maxPicks })}</p>}
                  {q.kind === 'CHOICE' && q.minPicks > 1 && <p part="rule">{t('customise.pickAtLeast', { count: q.minPicks })}</p>}
                  {q.kind === 'CHOICE' && q.freePicks > 0 && <p part="rule">{t('customise.free', { count: q.freePicks })}</p>}
                  {problem && (
                    <p part="problem" role="alert">
                      {problemText(problem)}
                    </p>
                  )}
                </div>
                {/* An optional pick-one list offers "None": a radio can't be unticked (fact 53). */}
                {q.kind === 'CHOICE' && q.maxPicks === 1 && !q.required && q.minPicks === 0 && (
                  <label part="choice">
                    <input type="radio" name={q.id} {...invalid} checked={!(a?.choices ?? []).some((x) => x.quantity > 0)} onChange={() => set(q.id, { choices: [] })} />
                    <span>{t('customise.none')}</span>
                  </label>
                )}
                {q.kind === 'CHOICE' &&
                  q.choices.map((c) => {
                    const picked = a?.choices?.find((x) => x.choiceId === c.id)?.quantity ?? 0
                    const one = q.maxPicks === 1
                    const unavailable = !c.available || (c.price !== null && c.price.mode !== 'PERCENT' && c.price.amount === null)
                    const pick = (n: number) => {
                      const others = one ? [] : (a?.choices ?? []).filter((x) => x.choiceId !== c.id)
                      set(q.id, { choices: n > 0 ? [...others, { choiceId: c.id, quantity: n }] : others })
                    }
                    return (
                      <label key={c.id} part="choice" aria-disabled={unavailable || undefined}>
                        <input type={one ? 'radio' : 'checkbox'} name={q.id} {...invalid} checked={picked > 0} disabled={unavailable} onChange={(e) => pick(e.target.checked ? 1 : 0)} />
                        {c.photoUrl && <img part="photo" src={c.photoUrl} alt="" width={40} height={40} />}
                        <span>{c.label}</span>
                        {!one && c.maxQuantity > 1 && picked > 0 && (
                          <input type="number" min={1} max={c.maxQuantity} value={picked} aria-label={t('customise.quantity', { name: c.label })} onChange={(e) => pick(Math.max(1, Math.min(c.maxQuantity, Number(e.target.value) || 1)))} />
                        )}
                        <span part="extra">{unavailable ? t('customise.unavailable') : extraText(c.price)}</span>
                      </label>
                    )
                  })}
                {q.kind === 'TEXT' && (
                  <>
                    {q.multiline ? (
                      <textarea aria-label={q.label} {...invalid} maxLength={q.maxLength} placeholder={q.example ?? undefined} value={a?.text ?? ''} rows={3} onChange={(e) => set(q.id, { text: e.target.value })} />
                    ) : (
                      <input type="text" aria-label={q.label} {...invalid} maxLength={q.maxLength} placeholder={q.example ?? undefined} value={a?.text ?? ''} onChange={(e) => set(q.id, { text: e.target.value })} />
                    )}
                    <span part="hint">
                      {q.price && extraText(q.price)
                        ? t('customise.charactersWithExtra', { count: [...(a?.text ?? '')].length, max: q.maxLength, extra: extraText(q.price) ?? '' })
                        : t('customise.characters', { count: [...(a?.text ?? '')].length, max: q.maxLength })}
                    </span>
                  </>
                )}
                {q.kind === 'UPLOAD' && (
                  <>
                    <ul part="files">
                      {(files[q.id] ?? []).map((f) => (
                        <li key={f.key}>
                          <span>{f.name}</span>{' '}
                          {f.failed ? (
                            <span part="error" role="alert">
                              {t(f.failed)}
                            </span>
                          ) : f.id ? null : (
                            <span part="hint" role="status">
                              {t('customise.uploading', { percent: Math.round(f.percent * 100) })}
                            </span>
                          )}{' '}
                          <button type="button" part="button" onClick={() => removeFile(q, f)}>
                            {t('customise.remove', { name: f.name })}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {(files[q.id] ?? []).filter((f) => !f.failed).length < q.maxFiles && (
                      <label part="button">
                        {t(q.accept === 'IMAGE' ? 'customise.addPhoto' : 'customise.addFile')}
                        <input
                          type="file"
                          {...invalid}
                          accept={acceptOf(q)}
                          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            e.target.value = ''
                            if (file) upload(q, file)
                          }}
                        />
                      </label>
                    )}
                    {q.price && <span part="hint">{extraText(q.price)}</span>}
                  </>
                )}
              </fieldset>
            )
          })}
          <p part="total" aria-live="polite">
            <span>{t('customise.total')}</span>
            <span>{quote?.lineTotal ? money(quote.lineTotal) : t('customise.totalWorking')}</span>
          </p>
          {error && (
            <p part="error" role="alert">
              {error}
            </p>
          )}
          <div part="actions">
            <button type="button" part="button" disabled={busy} onClick={() => close(false)}>
              {t('customise.cancel')}
            </button>
            <button type="submit" part="button primary" disabled={busy || Object.values(files).some((list) => list.some((f) => !f.id && !f.failed))}>
              {t(intent.kind === 'edit' ? 'customise.save' : intent.kind === 'buy' ? 'customise.buy' : 'customise.add')}
            </button>
          </div>
        </form>
      </dialog>
    </Sealed>
  )
}

