import { minorOf, moneyText } from '@dripfunnel/shared/format'

// A product's questions as the editor edits them (CATALOG-DESIGN §6 U, facts 49–57): amounts typed in major units, versions by
// their choices, conditions by the questions' own keys, so reordering or adding a version never breaks one.

export type QuestionKind = 'CHOICE' | 'TEXT' | 'UPLOAD'
export type PriceMode = 'FIXED' | 'PERCENT' | 'PER_CHARACTER'
export type Accept = 'IMAGE' | 'PDF' | 'IMAGE_PDF'

export const maxQuestions = 10
export const maxChoices = 50

export interface PriceDraft {
  mode: PriceMode
  per: 'ITEM' | 'LINE'
  /** Major units in the pricing currency, as typed. */
  amount: string
  /** Whole percent of the version's price ("10"), for PERCENT. */
  percent: string
  /** Major units by manual currency (U7); one left empty makes it not available in that currency. */
  manual: Record<string, string>
  /** A version's own amount by its choices' key (U7 "Different amount for each version"); empty uses `amount`. */
  byVersion: Record<string, string>
}

export interface ChoiceDraft {
  id: string | null
  /** The editor's own name for it, so a condition keeps pointing at it while ids are new. */
  key: string
  label: string
  available: boolean
  maxQuantity: string
  photoAssetId: string | null
  price: PriceDraft | null
}

export interface QuestionDraft {
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
  /** Versions by their choices' key; null is every version (U10: all ticked stores none). */
  versions: string[] | null
  choices: ChoiceDraft[]
}

/** As the Store API reads them (apps/api/schema/store.graphql ProductQuestion). */
export interface StoredPrice {
  mode: string
  per: string
  percentBps: number | null
  amounts: { currency: string; amount: string }[]
  versionAmounts: { versionId: string; amounts: { currency: string; amount: string }[] }[]
}
export interface StoredQuestion {
  id: string
  kind: string
  label: string
  help: string | null
  required: boolean
  minPicks: number | null
  maxPicks: number | null
  freePicks: number | null
  maxLength: number | null
  multiline: boolean | null
  example: string | null
  accept: string | null
  maxFiles: number | null
  price: StoredPrice | null
  shownIf: { questionId: string; choiceId: string } | null
  versionIds: string[] | null
  choices: { id: string; label: string; photoAssetId: string | null; available: boolean; maxQuantity: number; price: StoredPrice | null }[]
}

let next = 0
/** A key no other question or choice in this editor has. */
export const newKey = (): string => `q${(next += 1)}`

const blankPrice = (mode: PriceMode = 'FIXED'): PriceDraft => ({ mode, per: 'ITEM', amount: '', percent: '', manual: {}, byVersion: {} })
export const newPrice = blankPrice

export const newChoice = (label = ''): ChoiceDraft => ({ id: null, key: newKey(), label, available: true, maxQuantity: '1', photoAssetId: null, price: null })

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

const textOf = (minor: string | undefined, currency: string) => (minor === undefined ? '' : moneyText({ amount: Number(minor), currency }))

const priceDraftOf = (p: StoredPrice | null, currency: string, keyOfVersion: (id: string) => string | null): PriceDraft | null => {
  if (!p) return null
  const mode = (['FIXED', 'PERCENT', 'PER_CHARACTER'] as const).find((m) => m === p.mode) ?? 'FIXED'
  return {
    mode,
    per: p.per === 'LINE' ? 'LINE' : 'ITEM',
    amount: textOf(p.amounts.find((a) => a.currency === currency)?.amount, currency),
    percent: p.percentBps === null ? '' : String(p.percentBps / 100),
    manual: Object.fromEntries(p.amounts.filter((a) => a.currency !== currency).map((a) => [a.currency, textOf(a.amount, a.currency)])),
    byVersion: Object.fromEntries(
      p.versionAmounts.flatMap((v) => {
        const key = keyOfVersion(v.versionId)
        const amount = v.amounts.find((a) => a.currency === currency)?.amount
        return key && amount !== undefined ? [[key, textOf(amount, currency)]] : []
      }),
    ),
  }
}

/** The stored questions as the editor edits them; `keyOfVersion` names a version by its choices (productDraft versionKey). */
export const questionsDraftOf = (stored: readonly StoredQuestion[], currency: string, keyOfVersion: (id: string) => string | null): QuestionDraft[] => {
  const keyOf = new Map<string, string>()
  const drafts = stored.map((q) => {
    const key = newKey()
    keyOf.set(q.id, key)
    const choices = q.choices.map((c) => {
      const choiceKey = newKey()
      keyOf.set(c.id, choiceKey)
      return { id: c.id, key: choiceKey, label: c.label, available: c.available, maxQuantity: String(c.maxQuantity), photoAssetId: c.photoAssetId, price: priceDraftOf(c.price, currency, keyOfVersion) }
    })
    const kind = (['CHOICE', 'TEXT', 'UPLOAD'] as const).find((k) => k === q.kind) ?? 'TEXT'
    return {
      id: q.id,
      key,
      kind,
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
      shownIf: null as QuestionDraft['shownIf'],
      versions: q.versionIds ? q.versionIds.flatMap((id) => keyOfVersion(id) ?? []) : null,
      choices,
      stored: q,
    }
  })
  return drafts.map(({ stored: q, ...d }) => ({ ...d, shownIf: q.shownIf ? { question: keyOf.get(q.shownIf.questionId) ?? '', choice: keyOf.get(q.shownIf.choiceId) ?? '' } : null }))
}

export type QuestionProblem = { question: string; choice: string | null; field: 'label' | 'choices' | 'picks' | 'maxLength' | 'maxFiles' | 'price' | 'quantity' | 'versions' | 'free' }

const whole = (text: string, min: number, max: number): number | null => {
  const n = Number(text.trim())
  return /^\d+$/.test(text.trim()) && n >= min && n <= max ? n : null
}

const priceProblem = (p: PriceDraft, currency: string, kind: QuestionKind): boolean => {
  if (p.mode === 'PERCENT') return whole(p.percent, 1, 100) === null
  if (p.mode === 'PER_CHARACTER' && kind !== 'TEXT') return true
  const typed = [p.amount, ...Object.values(p.byVersion).filter((t) => t.trim() !== '')]
  return typeof minorOf(p.amount, currency) !== 'number' || typed.some((t) => typeof minorOf(t, currency) !== 'number') || Object.entries(p.manual).some(([c, t]) => t.trim() !== '' && typeof minorOf(t, c) !== 'number')
}

/** What would stop the save, by question and field, in the order the form shows them (U14). */
export const questionProblems = (drafts: readonly QuestionDraft[], currency: string): QuestionProblem[] =>
  drafts.flatMap((q): QuestionProblem[] => {
    const at = (field: QuestionProblem['field'], choice: string | null = null): QuestionProblem => ({ question: q.key, choice, field })
    const problems: QuestionProblem[] = []
    if (q.label.trim() === '') problems.push(at('label'))
    if (q.price && priceProblem(q.price, currency, q.kind)) problems.push(at('price'))
    if (q.versions !== null && q.versions.length === 0) problems.push(at('versions'))
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
  const minor = (text: string, c: string) => {
    const n = minorOf(text, c)
    return typeof n === 'number' ? String(n) : null
  }
  const priceOf = (p: PriceDraft | null) => {
    if (!p) return undefined
    if (p.mode === 'PERCENT') return { mode: p.mode, per: p.per, percentBps: Math.round(Number(p.percent) * 100) }
    const amounts = [{ currency, amount: minor(p.amount, currency) ?? '0' }, ...Object.entries(p.manual).flatMap(([c, t]) => (t.trim() === '' ? [] : [{ currency: c, amount: minor(t, c) ?? '0' }]))]
    const versionAmounts =
      p.mode === 'FIXED'
        ? Object.entries(p.byVersion).flatMap(([key, t]) => {
            const version = versionKeys.indexOf(key)
            return version === -1 || t.trim() === '' ? [] : [{ version, amounts: [{ currency, amount: minor(t, currency) ?? '0' }] }]
          })
        : []
    return { mode: p.mode, per: p.per, amounts, ...(versionAmounts.length > 0 ? { versionAmounts } : {}) }
  }
  const placeOf = new Map(drafts.flatMap((q, qi) => q.choices.map((c, ci) => [c.key, { question: qi, choice: ci }] as const)))
  return drafts.map((q) => {
    const versions = q.versions?.map((k) => versionKeys.indexOf(k)).filter((i) => i !== -1)
    const condition = q.shownIf ? placeOf.get(q.shownIf.choice) : undefined
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
    const price = priceOf(q.price)
    if (q.kind === 'TEXT') return { ...common, required: q.required, maxLength: Number(q.maxLength), multiline: q.multiline, ...(q.example.trim() ? { example: q.example.trim() } : {}), ...(price ? { price } : {}) }
    return { ...common, required: q.required, accept: q.accept, maxFiles: Number(q.maxFiles), ...(price ? { price } : {}) }
  })
}

/** The card's one-line summary's facts (U3), the words filled in by the section. */
export const summaryOf = (q: QuestionDraft) => ({
  kind: q.kind,
  required: q.kind === 'CHOICE' ? Number(q.minPicks) >= 1 : q.required,
  maxPicks: Number(q.maxPicks),
  freePicks: Number(q.freePicks),
  maxLength: Number(q.maxLength),
  maxFiles: Number(q.maxFiles),
})
