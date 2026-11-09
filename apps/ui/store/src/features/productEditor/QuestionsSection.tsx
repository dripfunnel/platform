import { useState } from 'react'
import { copyProductQuestions, searchProductsWithQuestions, uploadPhoto, type CopiedQuestions } from '../../api/productEditor'
import { fill, formatCount, messages, plural } from '../../messages'
import type { Draft } from '../common/productDraft'
import { maxChoices, maxQuestions, newChoice, newPrice, newQuestion, questionProblems, summaryOf, type ChoiceDraft, type PriceDraft, type QuestionDraft, type QuestionKind, type QuestionProblem } from '../common/productQuestions'
import type { Update } from './EditorCards'
import { Section } from './EditorSections'

// "Ask the shopper before they buy" (CATALOG-DESIGN §6 U): a product's questions, collapsed and empty for every product
// without any. No prototype draws it (decided on #1367): U1–U18 decide its layout, states and words.

const words = messages.editor.questions

interface Props {
  draft: Draft
  update: Update
  disabled: boolean
  currency: string
  /** The store's manual currencies, each with its own amount box (U7). */
  manual: readonly string[]
  /** The live versions by their key, as `versionKey` names them, with what the person reads. */
  versions: readonly { key: string; label: string }[]
  /** Copy needs the product saved with nothing unsaved (U12). */
  copy: { productId: string; revision: number; dirty: boolean; onCopied: (copied: CopiedQuestions) => void } | null
}

const problemText = (p: QuestionProblem, currency: string) =>
  ({
    label: p.choice ? words.choiceLabelRequired : words.labelRequired,
    choices: words.choiceRequired,
    picks: words.picksWrong,
    free: words.freeWrong,
    maxLength: words.lengthWrong,
    maxFiles: words.filesWrong,
    price: fill(words.priceWrong, { currency }),
    quantity: words.quantityWrong,
    versions: words.versionsNone,
  })[p.field]

const Problem = ({ problems, field, choice = null, currency }: { problems: readonly QuestionProblem[]; field: QuestionProblem['field']; choice?: string | null; currency: string }) => {
  const found = problems.find((p) => p.field === field && p.choice === choice)
  return found ? (
    <p className="df-editor-problem" role="alert">
      {problemText(found, currency)}
    </p>
  ) : null
}

/** U7: Free and "Add a price", then the amount, when it applies and, for a fixed amount, each version's own. */
const PriceEditor = ({ price, set, kind, currency, manual, versions, disabled, label }: { price: PriceDraft | null; set: (p: PriceDraft | null) => void; kind: QuestionKind | 'CHOICE_ROW'; currency: string; manual: readonly string[]; versions: Props['versions']; disabled: boolean; label: string }) => {
  if (!price) {
    return (
      <p className="df-question-price">
        <span>{words.priceFree}</span>{' '}
        {!disabled && (
          <button type="button" className="df-editor-link" aria-label={`${words.priceAdd}: ${label}`} onClick={() => set(newPrice())}>
            {words.priceAdd}
          </button>
        )}
      </p>
    )
  }
  const modes = (['FIXED', 'PERCENT', ...(kind === 'TEXT' ? ['PER_CHARACTER' as const] : [])] as const).map((m) => ({ m, text: m === 'FIXED' ? words.amountFixed : m === 'PERCENT' ? words.amountPercent : words.amountPerChar }))
  return (
    <fieldset className="df-question-price" disabled={disabled}>
      <legend>{label}</legend>
      <select aria-label={words.amountFixed} value={price.mode} onChange={(e) => set({ ...price, mode: e.target.value as PriceDraft['mode'] })}>
        {modes.map(({ m, text }) => (
          <option key={m} value={m}>
            {text}
          </option>
        ))}
      </select>
      {price.mode === 'PERCENT' ? (
        <label>
          {words.percent}
          <input inputMode="decimal" value={price.percent} onChange={(e) => set({ ...price, percent: e.target.value })} />
        </label>
      ) : (
        <>
          <label>
            {fill(words.amount, { currency })}
            <input inputMode="decimal" value={price.amount} onChange={(e) => set({ ...price, amount: e.target.value })} />
          </label>
          {manual.map((c) => (
            <label key={c}>
              {fill(words.manual, { currency: c })}
              <input inputMode="decimal" value={price.manual[c] ?? ''} onChange={(e) => set({ ...price, manual: { ...price.manual, [c]: e.target.value } })} />
            </label>
          ))}
        </>
      )}
      <label>
        {words.when}
        <select value={price.per} onChange={(e) => set({ ...price, per: e.target.value === 'LINE' ? 'LINE' : 'ITEM' })}>
          <option value="ITEM">{words.perItem}</option>
          <option value="LINE">{words.perLine}</option>
        </select>
      </label>
      {price.mode === 'FIXED' && versions.length > 1 && (
        <details>
          <summary>{words.byVersion}</summary>
          <p className="df-editor-hint">{words.byVersionHint}</p>
          {versions.map((v) => (
            <label key={v.key}>
              {v.label}
              <input inputMode="decimal" value={price.byVersion[v.key] ?? ''} onChange={(e) => set({ ...price, byVersion: { ...price.byVersion, [v.key]: e.target.value } })} />
            </label>
          ))}
        </details>
      )}
      {!disabled && (
        <button type="button" className="df-editor-link" onClick={() => set(null)}>
          {words.priceRemove}
        </button>
      )}
    </fieldset>
  )
}

const ChoiceRow = ({ choice, set, remove, move, first, last, many, currency, manual, versions, disabled, problems, questionKey }: { choice: ChoiceDraft; set: (c: ChoiceDraft) => void; remove: () => void; move: (by: -1 | 1) => void; first: boolean; last: boolean; many: boolean; currency: string; manual: readonly string[]; versions: Props['versions']; disabled: boolean; problems: readonly QuestionProblem[]; questionKey: string }) => {
  const [uploading, setUploading] = useState(false)
  const own = problems.filter((p) => p.question === questionKey)
  return (
    <li className="df-question-choice">
      <input aria-label={words.choice} maxLength={100} value={choice.label} readOnly={disabled} onChange={(e) => set({ ...choice, label: e.target.value })} />
      <Problem problems={own} field="label" choice={choice.key} currency={currency} />
      <label className="df-editor-switch">
        <input type="checkbox" checked={choice.available} disabled={disabled} onChange={(e) => set({ ...choice, available: e.target.checked })} />
        {words.available}
      </label>
      {many && (
        <label>
          {fill(words.maxQuantity, { n: choice.maxQuantity })}
          <input inputMode="numeric" value={choice.maxQuantity} readOnly={disabled} onChange={(e) => set({ ...choice, maxQuantity: e.target.value })} />
        </label>
      )}
      <Problem problems={own} field="quantity" choice={choice.key} currency={currency} />
      <span className="df-question-photo">
        {choice.photoAssetId ? (
          <>
            <img src={`/api/assets/${choice.photoAssetId}`} alt="" width={40} height={40} />
            {!disabled && (
              <button type="button" className="df-editor-link" onClick={() => set({ ...choice, photoAssetId: null })}>
                {words.photoRemove}
              </button>
            )}
          </>
        ) : uploading ? (
          <span role="status">{words.photoUploading}</span>
        ) : (
          !disabled && (
            <label className="df-editor-link">
              {words.photoAdd}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setUploading(true)
                  void uploadPhoto(file).then((result) => {
                    setUploading(false)
                    if (result.ok) set({ ...choice, photoAssetId: result.assetId })
                  })
                }}
              />
            </label>
          )
        )}
      </span>
      <PriceEditor price={choice.price} set={(price) => set({ ...choice, price })} kind="CHOICE_ROW" currency={currency} manual={manual} versions={versions} disabled={disabled} label={choice.label || words.choice} />
      <Problem problems={own} field="price" choice={choice.key} currency={currency} />
      {!disabled && (
        <span className="df-question-actions">
          <button type="button" className="df-editor-link" disabled={first} aria-label={`${words.moveUp}: ${choice.label || words.choice}`} onClick={() => move(-1)}>
            {words.moveUp}
          </button>
          <button type="button" className="df-editor-link" disabled={last} aria-label={`${words.moveDown}: ${choice.label || words.choice}`} onClick={() => move(1)}>
            {words.moveDown}
          </button>
          <button type="button" className="df-editor-link" aria-label={`${words.removeChoice}: ${choice.label}`} onClick={remove}>
            {words.removeChoice}
          </button>
        </span>
      )}
    </li>
  )
}

const QuestionCard = ({ q, index, all, setQ, move, remove, props, problems }: { q: QuestionDraft; index: number; all: readonly QuestionDraft[]; setQ: (q: QuestionDraft) => void; move: (by: -1 | 1) => void; remove: () => void; props: Props; problems: readonly QuestionProblem[] }) => {
  const { disabled, currency, manual, versions } = props
  const [confirming, setConfirming] = useState(false)
  const own = problems.filter((p) => p.question === q.key && p.choice === null)
  const s = summaryOf(q)
  const summary =
    q.kind === 'CHOICE'
      ? [s.maxPicks > 1 ? fill(words.summaryChoice, { max: formatCount(s.maxPicks) }) : words.summaryOne, ...(s.freePicks > 0 ? [fill(words.summaryFree, { n: formatCount(s.freePicks) })] : [])].join(' · ')
      : q.kind === 'TEXT'
        ? fill(words.summaryText, { n: formatCount(s.maxLength) })
        : fill(plural(words.summaryUpload, s.maxFiles), { n: formatCount(s.maxFiles) })
  // U9: only the choice lists above it with no condition of their own, and none for a question others depend on.
  const dependedOn = all.some((x) => x.shownIf?.question === q.key)
  const candidates = all.slice(0, index).filter((x) => x.kind === 'CHOICE' && x.shownIf === null)
  const many = Number(q.maxPicks) > 1
  return (
    <li className="df-question-card">
      <header>
        <strong>{q.label || words.question}</strong>
        <span>{q.kind === 'CHOICE' ? words.kindChoice : q.kind === 'TEXT' ? words.kindText : words.kindUpload}</span>
        <span>{s.required ? words.required : words.optional}</span>
        <span>{summary}</span>
        {!disabled && (
          <span className="df-question-actions">
            <button type="button" className="df-editor-link" disabled={index === 0} onClick={() => move(-1)}>
              {words.moveUp}
            </button>
            <button type="button" className="df-editor-link" disabled={index === all.length - 1} onClick={() => move(1)}>
              {words.moveDown}
            </button>
            <button type="button" className="df-editor-link" onClick={() => setConfirming(true)}>
              {words.delete}
            </button>
          </span>
        )}
      </header>
      {confirming && (
        <div className="df-question-confirm" role="alertdialog" aria-label={words.delete}>
          <p>{fill(words.deleteConfirm, { label: q.label || words.question })}</p>
          <button type="button" className="df-button df-button--danger" onClick={remove}>
            {words.deleteYes}
          </button>
          <button type="button" className="df-button" onClick={() => setConfirming(false)}>
            {words.keep}
          </button>
        </div>
      )}
      <label>
        {words.question}
        <input maxLength={200} placeholder={words.questionPlaceholder} value={q.label} readOnly={disabled} onChange={(e) => setQ({ ...q, label: e.target.value })} />
      </label>
      <Problem problems={own} field="label" currency={currency} />
      <label>
        {words.help}
        <input maxLength={500} value={q.help} readOnly={disabled} onChange={(e) => setQ({ ...q, help: e.target.value })} />
      </label>
      {q.kind === 'CHOICE' && (
        <>
          <p className="df-editor-label">{words.choices}</p>
          <ul className="df-question-choices">
            {q.choices.map((c, ci) => (
              <ChoiceRow
                key={c.key}
                choice={c}
                many={many}
                questionKey={q.key}
                problems={problems}
                currency={currency}
                manual={manual}
                versions={versions}
                disabled={disabled}
                set={(next) => setQ({ ...q, choices: q.choices.map((x, j) => (j === ci ? next : x)) })}
                remove={() => setQ({ ...q, choices: q.choices.filter((_, j) => j !== ci) })}
                first={ci === 0}
                last={ci === q.choices.length - 1}
                move={(by) => {
                  const moved = [...q.choices]
                  const [one] = moved.splice(ci, 1)
                  if (one) moved.splice(ci + by, 0, one)
                  setQ({ ...q, choices: moved })
                }}
              />
            ))}
          </ul>
          <Problem problems={own} field="choices" currency={currency} />
          {!disabled &&
            (q.choices.length < maxChoices ? (
              <button type="button" className="df-editor-link" onClick={() => setQ({ ...q, choices: [...q.choices, newChoice()] })}>
                {words.addChoiceRow}
              </button>
            ) : (
              <p className="df-editor-hint">{words.choiceLimit}</p>
            ))}
          <fieldset disabled={disabled}>
            <legend>{words.howMany}</legend>
            <label>
              <input type="radio" name={`${q.key}-many`} checked={!many} onChange={() => setQ({ ...q, maxPicks: '1', minPicks: q.required ? '1' : '0', freePicks: '0' })} />
              {words.pickOne}
            </label>
            <label>
              <input type="radio" name={`${q.key}-many`} checked={many} onChange={() => setQ({ ...q, maxPicks: '3' })} />
              {words.pickUpTo}
            </label>
            {many && (
              <>
                <input aria-label={words.pickUpTo} inputMode="numeric" value={q.maxPicks} onChange={(e) => setQ({ ...q, maxPicks: e.target.value })} />
                <label>
                  {words.atLeast}
                  <input inputMode="numeric" value={q.minPicks} onChange={(e) => setQ({ ...q, minPicks: e.target.value, required: Number(e.target.value) >= 1 })} />
                </label>
                {q.choices.some((c) => c.price !== null) && (
                  <label>
                    {fill(words.free, { n: q.freePicks })}
                    <input inputMode="numeric" value={q.freePicks} onChange={(e) => setQ({ ...q, freePicks: e.target.value })} />
                  </label>
                )}
              </>
            )}
          </fieldset>
          <Problem problems={own} field="picks" currency={currency} />
          <Problem problems={own} field="free" currency={currency} />
        </>
      )}
      {q.kind === 'TEXT' && (
        <fieldset disabled={disabled}>
          <label>
            <input type="radio" name={`${q.key}-lines`} checked={!q.multiline} onChange={() => setQ({ ...q, multiline: false })} />
            {words.single}
          </label>
          <label>
            <input type="radio" name={`${q.key}-lines`} checked={q.multiline} onChange={() => setQ({ ...q, multiline: true })} />
            {words.paragraph}
          </label>
          <label>
            {words.maxLength}
            <input inputMode="numeric" value={q.maxLength} onChange={(e) => setQ({ ...q, maxLength: e.target.value })} />
          </label>
          <Problem problems={own} field="maxLength" currency={currency} />
          <label>
            {words.example}
            <input maxLength={100} value={q.example} onChange={(e) => setQ({ ...q, example: e.target.value })} />
          </label>
        </fieldset>
      )}
      {q.kind === 'UPLOAD' && (
        <fieldset disabled={disabled}>
          <label>
            {words.accepts}
            <select value={q.accept} onChange={(e) => setQ({ ...q, accept: e.target.value as QuestionDraft['accept'] })}>
              <option value="IMAGE">{words.acceptImage}</option>
              <option value="PDF">{words.acceptPdf}</option>
              <option value="IMAGE_PDF">{words.acceptBoth}</option>
            </select>
          </label>
          <label>
            {words.maxFiles}
            <input inputMode="numeric" value={q.maxFiles} onChange={(e) => setQ({ ...q, maxFiles: e.target.value })} />
          </label>
          <Problem problems={own} field="maxFiles" currency={currency} />
          <p className="df-editor-hint">{words.sizeNote}</p>
        </fieldset>
      )}
      {q.kind !== 'CHOICE' && (
        <label className="df-editor-switch">
          <input type="checkbox" checked={q.required} disabled={disabled} onChange={(e) => setQ({ ...q, required: e.target.checked })} />
          {words.required}
        </label>
      )}
      {q.kind === 'CHOICE' && !many && (
        <label className="df-editor-switch">
          <input type="checkbox" checked={Number(q.minPicks) >= 1} disabled={disabled} onChange={(e) => setQ({ ...q, required: e.target.checked, minPicks: e.target.checked ? '1' : '0' })} />
          {words.required}
        </label>
      )}
      {q.kind !== 'CHOICE' && (
        <>
          <PriceEditor price={q.price} set={(price) => setQ({ ...q, price })} kind={q.kind} currency={currency} manual={manual} versions={versions} disabled={disabled} label={q.label || words.question} />
          <Problem problems={own} field="price" currency={currency} />
        </>
      )}
      <label>
        {words.onlyWhen}
        {dependedOn ? (
          <span className="df-editor-hint">{words.onlyWhenTaken}</span>
        ) : (
          <select
            disabled={disabled}
            value={q.shownIf ? `${q.shownIf.question}:${q.shownIf.choice}` : ''}
            onChange={(e) => {
              const [question = '', choice = ''] = e.target.value.split(':')
              setQ({ ...q, shownIf: e.target.value === '' ? null : { question, choice } })
            }}
          >
            <option value="">{words.onlyWhenAlways}</option>
            {candidates.flatMap((x) =>
              x.choices.map((c) => (
                <option key={`${x.key}:${c.key}`} value={`${x.key}:${c.key}`}>
                  {fill(words.onlyWhenOption, { question: x.label || words.question, choice: c.label || words.choice })}
                </option>
              )),
            )}
          </select>
        )}
      </label>
      {versions.length > 1 && (
        <fieldset disabled={disabled}>
          <legend>{words.versions}</legend>
          {versions.map((v) => {
            const ticked = q.versions === null || q.versions.includes(v.key)
            return (
              <label key={v.key}>
                <input
                  type="checkbox"
                  checked={ticked}
                  onChange={(e) => {
                    const now = new Set(q.versions ?? versions.map((x) => x.key))
                    if (e.target.checked) now.add(v.key)
                    else now.delete(v.key)
                    // All ticked is every version, stored as none (U10).
                    setQ({ ...q, versions: now.size === versions.length ? null : [...now] })
                  }}
                />
                {v.label}
              </label>
            )
          })}
          <Problem problems={own} field="versions" currency={currency} />
        </fieldset>
      )}
    </li>
  )
}

/** U12: a product search of the ones that have questions, a confirm that names what's replaced, and what couldn't come. */
const CopyQuestions = ({ copy, has }: { copy: NonNullable<Props['copy']>; has: number }) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<{ id: string; name: string; questionCount: number }[] | null>(null)
  const [chosen, setChosen] = useState<{ id: string; name: string; questionCount: number } | null>(null)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'copying' } | { kind: 'done'; copied: CopiedQuestions } | { kind: 'failed' }>({ kind: 'idle' })
  if (copy.dirty) return <p className="df-editor-hint">{`${words.copy}: ${words.copySave}`}</p>
  if (!open) {
    return (
      <button type="button" className="df-editor-link" onClick={() => setOpen(true)}>
        {words.copy}
      </button>
    )
  }
  const count = (n: number) => fill(plural(words.count, n), { count: formatCount(n) })
  return (
    <div className="df-question-copy">
      <label>
        {words.copySearch}
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            void searchProductsWithQuestions(e.target.value).then((list) => setFound(list.filter((p) => p.id !== copy.productId)))
          }}
        />
      </label>
      {found && found.length === 0 && <p className="df-editor-hint">{words.copyNone}</p>}
      <ul>
        {(found ?? []).map((p) => (
          <li key={p.id}>
            <button type="button" className="df-editor-link" onClick={() => setChosen(p)}>
              {fill(words.copyItem, { name: p.name, count: count(p.questionCount) })}
            </button>
          </li>
        ))}
      </ul>
      {chosen && state.kind !== 'done' && (
        <div role="alertdialog" aria-label={words.copy}>
          <p>{fill(has > 0 ? words.copyConfirm : words.copyConfirmNone, { count: count(chosen.questionCount), name: chosen.name })}</p>
          <button
            type="button"
            className="df-button df-button--primary"
            disabled={state.kind === 'copying'}
            onClick={() => {
              setState({ kind: 'copying' })
              copyProductQuestions(chosen.id, copy.productId, copy.revision).then(
                (copied) => {
                  setState({ kind: 'done', copied })
                  copy.onCopied(copied)
                },
                () => setState({ kind: 'failed' }),
              )
            }}
          >
            {words.copyYes}
          </button>
        </div>
      )}
      {state.kind === 'done' && (
        <p role="status">
          {words.copyDone}{' '}
          {state.copied.droppedAmounts + state.copied.droppedVersionLimits + state.copied.droppedPhotos > 0 &&
            fill(words.copyDropped, { amounts: formatCount(state.copied.droppedAmounts), limits: formatCount(state.copied.droppedVersionLimits), photos: formatCount(state.copied.droppedPhotos) })}
        </p>
      )}
      {state.kind === 'failed' && <p role="alert">{words.copyFailed}</p>}
    </div>
  )
}

export const QuestionsSection = (props: Props) => {
  const { draft, update, disabled, currency } = props
  const questions = draft.questions
  const [open, setOpen] = useState(false)
  const problems = questionProblems(questions, currency)
  const setQuestions = (change: (q: QuestionDraft[]) => QuestionDraft[]) => update((d) => ({ ...d, questions: change(d.questions) }))
  const summary = questions.length > 0 ? fill(plural(words.count, questions.length), { count: formatCount(questions.length) }) : words.hint
  return (
    <Section title={words.title} summary={summary} open={open} onToggle={() => setOpen((o) => !o)} problem={problems.length > 0}>
      {questions.length === 0 && <p className="df-editor-hint">{words.explain}</p>}
      <ol className="df-questions">
        {questions.map((q, i) => (
          <QuestionCard
            key={q.key}
            q={q}
            index={i}
            all={questions}
            props={props}
            problems={problems}
            setQ={(next) => setQuestions((list) => list.map((x, j) => (j === i ? next : x)))}
            move={(by) =>
              setQuestions((list) => {
                const moved = [...list]
                const [one] = moved.splice(i, 1)
                if (one) moved.splice(i + by, 0, one)
                // A condition can only point up the list (U9): one that now points down is cleared.
                return moved.map((x, j) => (x.shownIf && moved.findIndex((y) => y.key === x.shownIf?.question) > j ? { ...x, shownIf: null } : x))
              })
            }
            remove={() => setQuestions((list) => list.filter((x) => x.key !== q.key).map((x) => (x.shownIf?.question === q.key ? { ...x, shownIf: null } : x)))}
          />
        ))}
      </ol>
      {!disabled &&
        (questions.length < maxQuestions ? (
          <div className="df-question-add" role="group" aria-label={words.add}>
            <span>{words.add}</span>
            {(['CHOICE', 'TEXT', 'UPLOAD'] as const).map((kind) => (
              <button key={kind} type="button" className="df-editor-chip" onClick={() => setQuestions((list) => [...list, newQuestion(kind)])}>
                {kind === 'CHOICE' ? words.addChoice : kind === 'TEXT' ? words.addText : words.addUpload}
              </button>
            ))}
          </div>
        ) : (
          <p className="df-editor-hint">{words.limit}</p>
        ))}
      {!disabled && props.copy && <CopyQuestions copy={props.copy} has={questions.length} />}
    </Section>
  )
}
