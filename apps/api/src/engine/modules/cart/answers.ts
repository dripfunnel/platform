import { applyBps } from '#core/money'
import { isUuid } from '#core/ids'
import type { StoredAnswer } from '#db/scoped/cart'
import type { ShopChoice, ShopExtraPrice, ShopQuestion } from '#engine/modules/storefront/index'

export type { StoredAnswer } from '#db/scoped/cart'
export type { ShopChoice, ShopExtraPrice, ShopQuestion } from '#engine/modules/storefront/index'

// A line's answers checked and priced, pure (PLATFORM-PROMPT §5.4): the cart, the quote and placement share these rules,
// so the shopper is never shown one price and charged another.

export interface AnswerInput {
  questionId: string
  choices?: readonly { choiceId: string; quantity?: number | null | undefined }[] | null | undefined
  text?: string | null | undefined
  uploadIds?: readonly string[] | null | undefined
}


export type AnswerReason = 'UNKNOWN' | 'WRONG_KIND' | 'REQUIRED' | 'TOO_FEW_PICKS' | 'TOO_MANY_PICKS' | 'QUANTITY_TOO_HIGH' | 'CHOICE_UNAVAILABLE' | 'TEXT_TOO_LONG' | 'TOO_MANY_FILES' | 'UPLOAD_NOT_FOUND'
export interface AnswerProblem {
  questionId: string
  choiceId: string | null
  reason: AnswerReason
}

export interface ExtraChoice {
  choiceId: string
  label: string
  mainLabel: string
  quantity: number
  /** How many of these units the free allowance covers. */
  free: number
  unit: bigint
  amount: bigint
  per: 'item' | 'line'
}

/** One answered question, priced: what the line shows and what placement snapshots. */
export interface PricedAnswer {
  questionId: string
  label: string
  mainLabel: string
  kind: ShopQuestion['kind']
  choices: ExtraChoice[]
  text: string | null
  uploads: string[]
  /** A text or upload answer's own amount; null for a list (its choices carry theirs) or a free answer. */
  unit: bigint | null
  amount: bigint
  /** A text or upload answer's; a list's choices each say their own. */
  per: 'item' | 'line' | null
}

export interface CheckedAnswers {
  stored: StoredAnswer[]
  priced: PricedAnswer[]
  problems: AnswerProblem[]
  /** Added to each unit's price. */
  unitExtras: bigint
  /** Added once to the line. */
  lineExtras: bigint
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
/** Characters as the shopper sees them (grapheme clusters), spaces inside included (fact 53). */
export const characters = (text: string): number => [...segmenter.segment(text)].length

const amountFor = (price: ShopExtraPrice, versionId: string): bigint | null => (price.byVersion.has(versionId) ? (price.byVersion.get(versionId) ?? null) : price.amount)

/** What one unit of an extra costs for this version at version price `p`; null when it can't be priced in this currency. */
const unitOf = (price: ShopExtraPrice, versionId: string, p: bigint, chars = 1): bigint | null => {
  if (price.mode === 'percent') return applyBps({ amount: p, currency: 'XXX' }, price.bps ?? 0).amount
  const amount = amountFor(price, versionId)
  if (amount === null) return null
  return price.mode === 'per_character' ? amount * BigInt(chars) : amount
}

const cleanText = (raw: string, multiline: boolean): string => {
  const text = raw.normalize('NFC').trim()
  return multiline ? text.replace(/\r\n?/g, '\n') : text.replace(/[\r\n]+/g, ' ')
}

/** Only questions shown for the line count (PLATFORM-PROMPT §5.4); a hidden question's answer is dropped, never refused. */
export const checkAnswers = (
  questions: readonly ShopQuestion[],
  versionId: string,
  versionPrice: bigint,
  input: readonly AnswerInput[],
  uploadKnown: (uploadId: string, questionId: string) => boolean = () => false,
): CheckedAnswers => {
  const problems: AnswerProblem[] = []
  const problem = (questionId: string, reason: AnswerReason, choiceId: string | null = null) => problems.push({ questionId, choiceId, reason })
  const byId = new Map(questions.map((q) => [q.id, q]))
  const given = new Map<string, AnswerInput>()
  for (const a of input) {
    const id = a.questionId.toLowerCase()
    if (!isUuid(id) || !byId.has(id) || given.has(id)) problem(a.questionId, 'UNKNOWN')
    else given.set(id, a)
  }
  const picked = (questionId: string) => new Set((given.get(questionId)?.choices ?? []).map((c) => c.choiceId.toLowerCase()))
  const forVersion = (q: ShopQuestion) => q.versionIds.length === 0 || q.versionIds.includes(versionId)
  const owner = new Map(questions.flatMap((q) => q.choices.map((c) => [c.id, q] as const)))
  const shown = (q: ShopQuestion): boolean => {
    if (!forVersion(q)) return false
    if (!q.shownIfChoiceId) return true
    const on = owner.get(q.shownIfChoiceId)
    return on !== undefined && forVersion(on) && on.shownIfChoiceId === null && picked(on.id).has(q.shownIfChoiceId)
  }
  const stored: StoredAnswer[] = []
  const priced: PricedAnswer[] = []
  let unitExtras = 0n
  let lineExtras = 0n
  const add = (per: 'item' | 'line', amount: bigint) => {
    if (per === 'item') unitExtras += amount
    else lineExtras += amount
  }
  for (const q of [...questions].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!shown(q)) continue
    const a = given.get(q.id)
    const base = { questionId: q.id, label: q.label, mainLabel: q.mainLabel, kind: q.kind }
    if (q.kind === 'choice') {
      if (a && ((a.text ?? null) !== null || (a.uploadIds?.length ?? 0) > 0)) {
        problem(q.id, 'WRONG_KIND')
        continue
      }
      const choices = new Map(q.choices.map((c) => [c.id, c]))
      const picks: { choice: ShopChoice; quantity: number }[] = []
      let ok = true
      for (const c of a?.choices ?? []) {
        const choice = choices.get(c.choiceId.toLowerCase())
        const quantity = c.quantity ?? 1
        if (!choice || picks.some((p) => p.choice.id === choice.id) || !Number.isInteger(quantity) || quantity < 1) {
          problem(q.id, 'UNKNOWN', c.choiceId)
          ok = false
        } else if (quantity > choice.maxQuantity) {
          problem(q.id, 'QUANTITY_TOO_HIGH', choice.id)
          ok = false
        } else if (!choice.available || (choice.price !== null && unitOf(choice.price, versionId, versionPrice) === null)) {
          problem(q.id, 'CHOICE_UNAVAILABLE', choice.id)
          ok = false
        } else picks.push({ choice, quantity })
      }
      const units = picks.reduce((n, p) => n + p.quantity, 0)
      if (ok && units === 0 && (q.minPicks ?? 0) > 0) problem(q.id, 'REQUIRED')
      else if (ok && units < (q.minPicks ?? 0)) problem(q.id, 'TOO_FEW_PICKS')
      else if (ok && units > (q.maxPicks ?? 1)) problem(q.id, 'TOO_MANY_PICKS')
      if (!ok || units === 0) continue
      picks.sort((x, y) => x.choice.id.localeCompare(y.choice.id))
      stored.push({ question: q.id, choices: picks.map((p) => ({ choice: p.choice.id, quantity: p.quantity })) })
      // First N free: the units with the lowest amounts, ties by the choice's place (fact 51).
      const each = picks.flatMap((p) => Array.from({ length: p.quantity }, () => ({ id: p.choice.id, position: p.choice.position, unit: p.choice.price ? (unitOf(p.choice.price, versionId, versionPrice) ?? 0n) : 0n })))
      each.sort((x, y) => (x.unit === y.unit ? x.position - y.position : x.unit < y.unit ? -1 : 1))
      const freeOf = new Map<string, number>()
      for (const u of each.slice(0, q.freePicks ?? 0)) freeOf.set(u.id, (freeOf.get(u.id) ?? 0) + 1)
      const extras = picks.map((p): ExtraChoice => {
        const unit = p.choice.price ? (unitOf(p.choice.price, versionId, versionPrice) ?? 0n) : 0n
        const free = freeOf.get(p.choice.id) ?? 0
        return { choiceId: p.choice.id, label: p.choice.label, mainLabel: p.choice.mainLabel, quantity: p.quantity, free, unit, amount: unit * BigInt(p.quantity - free), per: p.choice.price?.per ?? 'item' }
      })
      for (const e of extras) add(e.per, e.amount)
      priced.push({ ...base, choices: extras, text: null, uploads: [], unit: null, amount: extras.reduce((s, e) => s + e.amount, 0n), per: null })
      continue
    }
    if (a && (a.choices?.length ?? 0) > 0) {
      problem(q.id, 'WRONG_KIND')
      continue
    }
    if (q.kind === 'text') {
      if (a && (a.uploadIds?.length ?? 0) > 0) {
        problem(q.id, 'WRONG_KIND')
        continue
      }
      const text = cleanText(a?.text ?? '', q.multiline ?? false)
      if (text === '') {
        if (q.required) problem(q.id, 'REQUIRED')
        continue
      }
      const chars = characters(text)
      if (chars > (q.maxLength ?? 100)) {
        problem(q.id, 'TEXT_TOO_LONG')
        continue
      }
      const unit = q.price ? unitOf(q.price, versionId, versionPrice, chars) : 0n
      if (unit === null) {
        problem(q.id, 'CHOICE_UNAVAILABLE')
        continue
      }
      stored.push({ question: q.id, text })
      add(q.price?.per ?? 'item', unit)
      priced.push({ ...base, choices: [], text, uploads: [], unit: q.price ? unit : null, amount: unit, per: q.price?.per ?? 'item' })
      continue
    }
    if (a && (a.text ?? null) !== null) {
      problem(q.id, 'WRONG_KIND')
      continue
    }
    const uploads = [...new Set((a?.uploadIds ?? []).map((u) => u.toLowerCase()))]
    if (uploads.length === 0) {
      if (q.required) problem(q.id, 'REQUIRED')
      continue
    }
    if (uploads.length > (q.maxFiles ?? 1)) {
      problem(q.id, 'TOO_MANY_FILES')
      continue
    }
    if (uploads.some((u) => !isUuid(u) || !uploadKnown(u, q.id))) {
      problem(q.id, 'UPLOAD_NOT_FOUND')
      continue
    }
    // An upload's price is once the question is answered, however many files (rule 5 prices "an upload").
    const unit = q.price ? unitOf(q.price, versionId, versionPrice) : 0n
    if (unit === null) {
      problem(q.id, 'CHOICE_UNAVAILABLE')
      continue
    }
    stored.push({ question: q.id, uploads: uploads.sort() })
    add(q.price?.per ?? 'item', unit)
    priced.push({ ...base, choices: [], text: null, uploads, unit: q.price ? unit : null, amount: unit, per: q.price?.per ?? 'item' })
  }
  return { stored, priced, problems, unitExtras, lineExtras }
}

/** A stored answer as the input it came from, to check a cart line again on every read. */
export const inputOf = (stored: readonly StoredAnswer[]): AnswerInput[] =>
  stored.map((s) => ('choices' in s ? { questionId: s.question, choices: s.choices.map((c) => ({ choiceId: c.choice, quantity: c.quantity })) } : 'text' in s ? { questionId: s.question, text: s.text } : { questionId: s.question, uploadIds: s.uploads }))

/**
 * The order line's immutable snapshot (DATA-MODEL §7.6): labels as the shopper saw them, the main language's beside them when
 * different, and each extra's unit and amount in the order's currency, as minor-unit strings.
 */
export const snapshotOf = (priced: readonly PricedAnswer[]): object[] =>
  priced.map((a) => ({
    question: a.questionId,
    label: a.label,
    main_label: a.mainLabel === a.label ? null : a.mainLabel,
    kind: a.kind,
    ...(a.kind === 'choice'
      ? { choices: a.choices.map((c) => ({ choice: c.choiceId, label: c.label, main_label: c.mainLabel === c.label ? null : c.mainLabel, quantity: c.quantity, free: c.free, unit: c.unit.toString(), amount: c.amount.toString(), per: c.per })) }
      : a.kind === 'text'
        ? { text: a.text }
        : { uploads: a.uploads }),
    unit: a.unit === null ? null : a.unit.toString(),
    amount: a.amount.toString(),
    per: a.per,
  }))
