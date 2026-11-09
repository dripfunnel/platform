import { minorOf, moneyText } from '@dripfunnel/mobile-shared/format'
import type { StoredPrice, StoredQuestion } from '../../../api/products'

// A product's questions as the phone's editor edits them (CATALOG-DESIGN §6 U, facts 49–57; the portal's productQuestions.ts):
// amounts as typed in the pricing currency, versions by their choices' key, conditions by the questions' own keys.

export type QuestionKind = 'CHOICE' | 'TEXT' | 'UPLOAD'
export type PriceMode = 'FIXED' | 'PERCENT' | 'PER_CHARACTER'
export type Accept = 'IMAGE' | 'PDF' | 'IMAGE_PDF'

export const maxQuestions = 10
export const maxChoices = 50

export type PriceDraft = {
  mode: PriceMode
  per: 'ITEM' | 'LINE'
  /** As typed, in the pricing currency. */
  amount: string
  /** Percent of the version's price, to the hundredth ("2.5"). */
  percent: string
  /** Other currencies' amounts as they came (minor units): Markets sets them, as it does the product's own prices (draft.ts). */
  manual: { currency: string; amount: string }[]
  /** A version's own amount by its key, as typed; empty uses `amount`. */
  byVersion: Record<string, string>
  /** A version's amounts in other currencies, by its key, as they came. */
  manualByVersion: Record<string, { currency: string; amount: string }[]>
}

export type ChoiceDraft = { id: string | null; key: string; label: string; available: boolean; maxQuantity: string; photoAssetId: string | null; price: PriceDraft | null }

export type QuestionDraft = {
  id: string | null
  key: string
  kind: QuestionKind
  label: string
  help: string
  required: boolean
  minPicks: string
  maxPicks: string
  freePicks: string
  maxLength: string
  multiline: boolean
  example: string
  accept: Accept
  maxFiles: string
  price: PriceDraft | null
  shownIf: { question: string; choice: string } | null
  /** Versions by their key; null is every version, including one made later (U10). */
  versions: string[] | null
  choices: ChoiceDraft[]
}

let next = 0
export const newKey = (): string => `k${(next += 1)}`

export const newPrice = (mode: PriceMode = 'FIXED'): PriceDraft => ({ mode, per: 'ITEM', amount: '', percent: '', manual: [], byVersion: {}, manualByVersion: {} })
export const newChoice = (): ChoiceDraft => ({ id: null, key: newKey(), label: '', available: true, maxQuantity: '1', photoAssetId: null, price: null })
export const newQuestion = (kind: QuestionKind): QuestionDraft => ({
  id: null,
  key: newKey(),
  kind,
  label: '',
  help: '',
  required: false,
  minPicks: '0',
  maxPicks: '1',
  freePicks: '0',
  maxLength: '100',
  multiline: false,
  example: '',
  accept: 'IMAGE',
  maxFiles: '1',
  price: null,
  shownIf: null,
  versions: null,
  choices: kind === 'CHOICE' ? [newChoice()] : [],
})

const typedOf = (amount: string | undefined, currency: string) => (amount === undefined ? '' : moneyText({ amount, currency }))

const priceDraftOf = (p: StoredPrice | null, currency: string, keyOfVersion: (id: string) => string | null): PriceDraft | null => {
  if (!p) return null
  return {
    mode: (['FIXED', 'PERCENT', 'PER_CHARACTER'] as const).find((m) => m === p.mode) ?? 'FIXED',
    per: p.per === 'LINE' ? 'LINE' : 'ITEM',
    amount: typedOf(p.amounts.find((a) => a.currency === currency)?.amount, currency),
    percent: p.percentBps === null ? '' : String(p.percentBps / 100),
    manual: p.amounts.filter((a) => a.currency !== currency),
    byVersion: Object.fromEntries(
      p.versionAmounts.flatMap((v) => {
        const key = keyOfVersion(v.versionId)
        const amount = v.amounts.find((a) => a.currency === currency)?.amount
        return key && amount !== undefined ? [[key, typedOf(amount, currency)]] : []
      }),
    ),
    manualByVersion: Object.fromEntries(
      p.versionAmounts.flatMap((v) => {
        const key = keyOfVersion(v.versionId)
        const others = v.amounts.filter((a) => a.currency !== currency)
        return key && others.length > 0 ? [[key, others]] : []
      }),
    ),
  }
}

/** The stored questions as the form edits them; `keyOfVersion` names a version by its choices (draft.ts versionKey). */
export const questionsDraftOf = (stored: readonly StoredQuestion[], currency: string, keyOfVersion: (id: string) => string | null): QuestionDraft[] => {
  const keyOf = new Map<string, string>()
  const drafts = stored.map((q): QuestionDraft => {
    const key = newKey()
    keyOf.set(q.id, key)
    const choices = q.choices.map((c) => {
      const choiceKey = newKey()
      keyOf.set(c.id, choiceKey)
      return { id: c.id, key: choiceKey, label: c.label, available: c.available, maxQuantity: String(c.maxQuantity), photoAssetId: c.photoAssetId, price: priceDraftOf(c.price, currency, keyOfVersion) }
    })
    return {
      id: q.id,
      key,
      kind: (['CHOICE', 'TEXT', 'UPLOAD'] as const).find((k) => k === q.kind) ?? 'TEXT',
      label: q.label,
      help: q.help ?? '',
      required: q.required,
      minPicks: String(q.minPicks ?? 0),
      maxPicks: String(q.maxPicks ?? 1),
      freePicks: String(q.freePicks ?? 0),
      maxLength: String(q.maxLength ?? 100),
      multiline: q.multiline ?? false,
      example: q.example ?? '',
      accept: (['IMAGE', 'PDF', 'IMAGE_PDF'] as const).find((a) => a === q.accept) ?? 'IMAGE',
      maxFiles: String(q.maxFiles ?? 1),
      price: priceDraftOf(q.price, currency, keyOfVersion),
      shownIf: null,
      versions: q.versionIds ? q.versionIds.flatMap((id) => keyOfVersion(id) ?? []) : null,
      choices,
    }
  })
  return drafts.map((d, i) => {
    const condition = stored[i]?.shownIf
    return condition ? { ...d, shownIf: { question: keyOf.get(condition.questionId) ?? '', choice: keyOf.get(condition.choiceId) ?? '' } } : d
  })
}

export type QuestionField = 'label' | 'choices' | 'picks' | 'free' | 'maxLength' | 'maxFiles' | 'price' | 'quantity' | 'versions' | 'versionsChanged'
export type QuestionProblem = { question: string; choice: string | null; field: QuestionField }

const whole = (text: string, min: number, max: number): number | null => {
  const n = Number(text.trim())
  return /^\d+$/.test(text.trim()) && n >= min && n <= max ? n : null
}

const percentOk = (text: string) => /^\d{1,3}(\.\d{1,2})?$/.test(text.trim()) && Number(text) > 0 && Number(text) <= 100
// minorOf answers 'invalid' as a string too.
const minorText = (text: string, currency: string): string | null => {
  const n = minorOf(text, currency)
  return n === null || n === 'invalid' ? null : n
}
const amountOk = (text: string, currency: string) => minorText(text, currency) !== null

const priceProblem = (p: PriceDraft, currency: string, kind: QuestionKind): boolean => {
  if (p.mode === 'PERCENT') return !percentOk(p.percent)
  if (p.mode === 'PER_CHARACTER' && kind !== 'TEXT') return true
  return !amountOk(p.amount, currency) || Object.values(p.byVersion).some((typed) => typed.trim() !== '' && !amountOk(typed, currency))
}

/** A condition stays only while it names a choice of a list above with no condition of its own (U9). */
export const withValidConditions = (drafts: readonly QuestionDraft[]): QuestionDraft[] =>
  drafts.map((q, i) => {
    if (!q.shownIf) return q
    const { question, choice } = q.shownIf
    const target = drafts.slice(0, i).find((x) => x.key === question)
    return target && target.kind === 'CHOICE' && target.shownIf === null && target.choices.some((c) => c.key === choice) ? q : { ...q, shownIf: null }
  })

/** The choice lists above `at` a condition may name (U9): no condition of their own, and never when others depend on `at`. */
export const conditionTargets = (drafts: readonly QuestionDraft[], at: number): QuestionDraft[] => {
  const self = drafts[at]
  if (!self || drafts.some((q) => q.shownIf?.question === self.key)) return []
  return drafts.slice(0, at).filter((q) => q.kind === 'CHOICE' && q.shownIf === null)
}

/** What would stop the save, by question and field (U14); `versionKeys` are the live versions' when there are several. */
export const questionProblems = (drafts: readonly QuestionDraft[], currency: string, versionKeys: readonly string[] | null = null): QuestionProblem[] =>
  drafts.flatMap((q): QuestionProblem[] => {
    const at = (field: QuestionField, choice: string | null = null): QuestionProblem => ({ question: q.key, choice, field })
    const problems: QuestionProblem[] = []
    if (q.label.trim() === '') problems.push(at('label'))
    if (q.price && priceProblem(q.price, currency, q.kind)) problems.push(at('price'))
    if (q.versions !== null && q.versions.length === 0) problems.push(at('versions'))
    // A version renamed or removed since it was ticked: picked again rather than sent as fewer, or all, versions.
    else if (q.versions !== null && versionKeys !== null && q.versions.some((k) => !versionKeys.includes(k))) problems.push(at('versionsChanged'))
    if (q.kind === 'CHOICE') {
      if (q.choices.length === 0) problems.push(at('choices'))
      const max = whole(q.maxPicks, 1, 99)
      const min = whole(q.minPicks, 0, 99)
      if (max === null || min === null || min > max) problems.push(at('picks'))
      if (max !== null && whole(q.freePicks, 0, max) === null) problems.push(at('free'))
      for (const c of q.choices) {
        if (c.label.trim() === '') problems.push(at('label', c.key))
        if (whole(c.maxQuantity, 1, 99) === null) problems.push(at('quantity', c.key))
        if (c.price && priceProblem(c.price, currency, 'CHOICE')) problems.push(at('price', c.key))
      }
    }
    if (q.kind === 'TEXT' && whole(q.maxLength, 1, 500) === null) problems.push(at('maxLength'))
    if (q.kind === 'UPLOAD' && whole(q.maxFiles, 1, 5) === null) problems.push(at('maxFiles'))
    return problems
  })

/** As ProductInput.questions takes them; `versionKeys` are the live versions' keys in the order the save sends them. */
export const questionsInputOf = (drafts: readonly QuestionDraft[], currency: string, versionKeys: readonly string[]) => {
  const minor = (text: string) => minorText(text, currency) ?? '0'
  const priceOf = (p: PriceDraft | null) => {
    if (!p) return undefined
    if (p.mode === 'PERCENT') return { mode: p.mode, per: p.per, percentBps: Math.round(Number(p.percent) * 100) }
    const versionAmounts =
      p.mode === 'FIXED'
        ? versionKeys.flatMap((key, version) => {
            const typed = p.byVersion[key] ?? ''
            const amounts = [...(typed.trim() === '' ? [] : [{ currency, amount: minor(typed) }]), ...(p.manualByVersion[key] ?? [])]
            return amounts.length === 0 ? [] : [{ version, amounts }]
          })
        : []
    return { mode: p.mode, per: p.per, amounts: [{ currency, amount: minor(p.amount) }, ...p.manual], ...(versionAmounts.length > 0 ? { versionAmounts } : {}) }
  }
  const placeOf = new Map(drafts.flatMap((q, qi) => q.choices.map((c, ci) => [c.key, { question: qi, choice: ci }] as const)))
  return drafts.map((q) => {
    const versions = q.versions?.map((k) => versionKeys.indexOf(k)).filter((i) => i !== -1)
    const condition = q.shownIf ? placeOf.get(q.shownIf.choice) : undefined
    const price = priceOf(q.price)
    const common = {
      ...(q.id ? { id: q.id } : {}),
      kind: q.kind,
      label: q.label.trim(),
      ...(q.help.trim() ? { help: q.help.trim() } : {}),
      ...(condition ? { shownIf: condition } : {}),
      ...(versions && versions.length > 0 && versions.length < versionKeys.length ? { versions } : {}),
    }
    if (q.kind === 'CHOICE') {
      const minPicks = Number(q.minPicks)
      return {
        ...common,
        required: minPicks >= 1,
        minPicks,
        maxPicks: Number(q.maxPicks),
        freePicks: Number(q.freePicks),
        choices: q.choices.map((c) => ({ ...(c.id ? { id: c.id } : {}), label: c.label.trim(), available: c.available, maxQuantity: Number(c.maxQuantity), ...(c.photoAssetId ? { photoAssetId: c.photoAssetId } : {}), ...(c.price ? { price: priceOf(c.price) } : {}) })),
      }
    }
    if (q.kind === 'TEXT') return { ...common, required: q.required, maxLength: Number(q.maxLength), multiline: q.multiline, ...(q.example.trim() ? { example: q.example.trim() } : {}), ...(price ? { price } : {}) }
    return { ...common, required: q.required, accept: q.accept, maxFiles: Number(q.maxFiles), ...(price ? { price } : {}) }
  })
}

/** Whether a question must be answered: a list by its minimum, the others by Required. */
export const isRequired = (q: QuestionDraft): boolean => (q.kind === 'CHOICE' ? Number(q.minPicks) >= 1 : q.required)

const swap = <T>(items: readonly T[], at: number, to: number): T[] => {
  if (to < 0 || to >= items.length) return [...items]
  const copy = [...items]
  const [moved] = copy.splice(at, 1)
  if (moved !== undefined) copy.splice(to, 0, moved)
  return copy
}

/** A question moved one place, its conditions kept valid (a condition only names a list above it). */
export const moveQuestion = (drafts: readonly QuestionDraft[], at: number, by: -1 | 1): QuestionDraft[] => withValidConditions(swap(drafts, at, at + by))
export const moveChoice = (choices: readonly ChoiceDraft[], at: number, by: -1 | 1): ChoiceDraft[] => swap(choices, at, at + by)

/** The questions whose condition names this question or one of its choices (asked first, U9). */
export const dependentsOf = (drafts: readonly QuestionDraft[], key: string, choice: string | null = null): QuestionDraft[] =>
  drafts.filter((q) => q.shownIf && (choice === null ? q.shownIf.question === key : q.shownIf.choice === choice))
