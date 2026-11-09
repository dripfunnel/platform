import { isUuid } from '#core/ids'
import { parseMinor } from '#core/money'
import type { AmountRow, ChoiceRow, PriceMode, PricePer, QuestionKind, QuestionRow, QuestionWrite } from '#db/scoped/questions'

// The rules of a product's questions (CATALOG-DESIGN §3 facts 49–57, U4–U13; DATA-MODEL §7.3), pure: what the editor may
// send, cleaned into what is written, or the one refusal that says which question, choice and field.

export const maxQuestions = 10
export const maxChoices = 50
const maxPicksCap = 99

export interface AmountInput {
  currency: string
  amount: string
}
export interface ExtraPriceInput {
  mode: string
  per: string
  percentBps?: number | null | undefined
  amounts?: readonly AmountInput[] | null | undefined
  /** A version by its place in the product's versions, as `filterValues` names one. */
  versionAmounts?: readonly { version: number; amounts: readonly AmountInput[] }[] | null | undefined
}
export interface ChoiceInput {
  id?: string | null | undefined
  label: string
  photoAssetId?: string | null | undefined
  available?: boolean | null | undefined
  maxQuantity?: number | null | undefined
  price?: ExtraPriceInput | null | undefined
}
export interface QuestionInput {
  id?: string | null | undefined
  kind: string
  label: string
  help?: string | null | undefined
  required?: boolean | null | undefined
  minPicks?: number | null | undefined
  maxPicks?: number | null | undefined
  freePicks?: number | null | undefined
  maxLength?: number | null | undefined
  multiline?: boolean | null | undefined
  example?: string | null | undefined
  accept?: string | null | undefined
  maxFiles?: number | null | undefined
  price?: ExtraPriceInput | null | undefined
  /** Another question and its choice, by their places in the same input. */
  shownIf?: { question: number; choice: number } | null | undefined
  /** Versions by their places in the product's versions; none or empty is every version. */
  versions?: readonly number[] | null | undefined
  choices?: readonly ChoiceInput[] | null | undefined
}

/** A cleaned question, versions still by place: the save turns them into ids once the versions are written. */
export interface CleanAmount {
  currency: string
  amount: string
  version: number | null
}
export interface CleanPrice {
  mode: PriceMode
  per: PricePer
  bps: number | null
  amounts: CleanAmount[]
}
export interface CleanChoice {
  id: string | null
  label: string
  photoAssetId: string | null
  available: boolean
  maxQuantity: number
  price: CleanPrice | null
}
export interface CleanQuestion {
  id: string | null
  kind: QuestionKind
  label: string
  help: string | null
  required: boolean
  minPicks: number | null
  maxPicks: number | null
  freePicks: number | null
  maxLength: number | null
  multiline: boolean | null
  example: string | null
  accept: 'image' | 'pdf' | 'image_pdf' | null
  maxFiles: number | null
  price: CleanPrice | null
  shownIf: { question: number; choice: number } | null
  versions: number[]
  choices: CleanChoice[]
}

export type QuestionField = 'kind' | 'label' | 'help' | 'example' | 'picks' | 'maxLength' | 'accept' | 'maxFiles' | 'price' | 'shownIf' | 'versions' | 'choices' | 'quantity' | 'photo' | 'id'
export type QuestionRefusal =
  | { reason: 'QUESTION_LIMIT'; limit: number }
  | { reason: 'CHOICE_LIMIT'; limit: number }
  | { reason: 'INVALID_QUESTION'; question: number; choice: number | null; field: QuestionField }
  | { reason: 'CURRENCY_NOT_SOLD' }

export interface QuestionContext {
  versionCount: number
  pricingCurrency: string
  /** The currencies an amount may be typed in: the pricing one, and the merchant side's manual ones. */
  currencies: ReadonlySet<string>
}

const given = (value: unknown) => value !== null && value !== undefined

const kinds: Record<string, QuestionKind> = { CHOICE: 'choice', TEXT: 'text', UPLOAD: 'upload' }
const accepts: Record<string, CleanQuestion['accept']> = { IMAGE: 'image', PDF: 'pdf', IMAGE_PDF: 'image_pdf' }
const modes: Record<string, PriceMode> = { FIXED: 'fixed', PERCENT: 'percent', PER_CHARACTER: 'per_character' }
const pers: Record<string, PricePer> = { ITEM: 'item', LINE: 'line' }

class Invalid extends Error {
  constructor(readonly refusal: QuestionRefusal) {
    super(refusal.reason)
  }
}

/** Trimmed text within its limit; null when empty and optional. */
const words = (value: string | null | undefined, max: number, required: boolean, at: () => never): string | null => {
  const clean = value?.trim() ?? ''
  if (clean === '') return required ? at() : null
  return clean.length > max ? at() : clean
}
const whole = (value: number | null | undefined, fallback: number, min: number, max: number, at: () => never): number => {
  const n = value ?? fallback
  return Number.isInteger(n) && n >= min && n <= max ? n : at()
}

const cleanAmounts = (amounts: readonly AmountInput[], version: number | null, ctx: QuestionContext, at: () => never): CleanAmount[] => {
  const seen = new Set<string>()
  const clean = amounts.map((a) => {
    const currency = a.currency.trim().toUpperCase()
    if (!ctx.currencies.has(currency)) throw new Invalid({ reason: 'CURRENCY_NOT_SOLD' })
    const money = parseMinor(a.amount.trim(), currency)
    if (!money || money.amount < 0n || seen.has(currency)) return at()
    seen.add(currency)
    return { currency, amount: money.amount.toString(), version }
  })
  // The pricing currency's is required: the others convert from it or are typed beside it (fact 51).
  return seen.has(ctx.pricingCurrency) ? clean : at()
}

const cleanPrice = (input: ExtraPriceInput | null | undefined, allowed: readonly PriceMode[], ctx: QuestionContext, at: () => never): CleanPrice | null => {
  if (!input) return null
  const mode = modes[input.mode]
  const per = pers[input.per]
  if (!mode || !per || !allowed.includes(mode)) return at()
  if (mode === 'percent') {
    if ((input.amounts?.length ?? 0) > 0 || (input.versionAmounts?.length ?? 0) > 0) return at()
    return { mode, per, bps: whole(input.percentBps, 0, 1, 10_000, at), amounts: [] }
  }
  if (input.percentBps !== null && input.percentBps !== undefined) return at()
  const amounts = cleanAmounts(input.amounts ?? [], null, ctx, at)
  // A version's own amount is for a fixed price only (fact 51), once per version.
  const versions = input.versionAmounts ?? []
  if (versions.length > 0 && mode !== 'fixed') return at()
  if (new Set(versions.map((v) => v.version)).size !== versions.length) return at()
  const byVersion = versions.flatMap((v) => (Number.isInteger(v.version) && v.version >= 0 && v.version < ctx.versionCount ? cleanAmounts(v.amounts, v.version, ctx, at) : at()))
  return { mode, per, bps: null, amounts: [...amounts, ...byVersion] }
}

const cleanId = (id: string | null | undefined, at: () => never): string | null => {
  if (id === null || id === undefined) return null
  const lower = id.trim().toLowerCase()
  return isUuid(lower) ? lower : at()
}

/** The editor's questions cleaned, or the first thing wrong with them (fact 55's limits before anything else). */
export const cleanQuestions = (input: readonly QuestionInput[], ctx: QuestionContext): CleanQuestion[] | QuestionRefusal => {
  if (input.length > maxQuestions) return { reason: 'QUESTION_LIMIT', limit: maxQuestions }
  if (input.some((q) => (q.choices?.length ?? 0) > maxChoices)) return { reason: 'CHOICE_LIMIT', limit: maxChoices }
  try {
    const questions = input.map((q, qi): CleanQuestion => {
      const at = (field: QuestionField, choice: number | null = null) => (): never => {
        throw new Invalid({ reason: 'INVALID_QUESTION', question: qi, choice, field })
      }
      const kind = kinds[q.kind] ?? at('kind')()
      const label = words(q.label, 200, true, at('label')) ?? at('label')()
      const help = words(q.help, 500, false, at('help'))
      const versions = [...new Set(q.versions ?? [])]
      if (versions.length !== (q.versions?.length ?? 0) || versions.some((v) => !Number.isInteger(v) || v < 0 || v >= ctx.versionCount)) at('versions')()
      const base = { id: cleanId(q.id, at('id')), kind, label, help, shownIf: q.shownIf ?? null, versions: versions.length === ctx.versionCount ? [] : versions.sort((a, b) => a - b) }
      const none = { minPicks: null, maxPicks: null, freePicks: null, maxLength: null, multiline: null, example: null, accept: null, maxFiles: null }
      if (kind === 'choice') {
        const list = q.choices ?? []
        if (list.length === 0) at('choices')()
        if (q.price) at('price')()
        if (given(q.maxLength) || given(q.multiline) || given(q.example) || given(q.accept) || given(q.maxFiles)) at('kind')()
        const labels = new Set<string>()
        const choices = list.map((c, ci): CleanChoice => {
          const choiceLabel = words(c.label, 100, true, at('label', ci)) ?? at('label', ci)()
          if (labels.has(choiceLabel.toLowerCase())) at('label', ci)()
          labels.add(choiceLabel.toLowerCase())
          return {
            id: cleanId(c.id, at('id', ci)),
            label: choiceLabel,
            photoAssetId: cleanId(c.photoAssetId, at('photo', ci)),
            available: c.available ?? true,
            maxQuantity: whole(c.maxQuantity, 1, 1, maxPicksCap, at('quantity', ci)),
            price: cleanPrice(c.price, ['fixed', 'percent'], ctx, at('price', ci)),
          }
        })
        const maxPicks = whole(q.maxPicks, 1, 1, maxPicksCap, at('picks'))
        const minPicks = whole(q.minPicks, q.required ? 1 : 0, 0, maxPicks, at('picks'))
        // Required is at least one pick (DATA-MODEL §7.3); saying both and disagreeing is a mistake, not a choice.
        if (q.required === true && minPicks === 0) at('picks')()
        if (q.required === false && minPicks > 0) at('picks')()
        const freePicks = whole(q.freePicks, 0, 0, maxPicks, at('picks'))
        return { ...base, ...none, required: minPicks >= 1, minPicks, maxPicks, freePicks, price: null, choices }
      }
      if ((q.choices?.length ?? 0) > 0 || given(q.minPicks) || given(q.maxPicks) || given(q.freePicks)) at('kind')()
      if (kind === 'text') {
        if (given(q.accept) || given(q.maxFiles)) at('kind')()
        return {
          ...base,
          ...none,
          required: q.required ?? false,
          maxLength: whole(q.maxLength, 100, 1, 500, at('maxLength')),
          multiline: q.multiline ?? false,
          example: words(q.example, 100, false, at('example')),
          price: cleanPrice(q.price, ['fixed', 'percent', 'per_character'], ctx, at('price')),
          choices: [],
        }
      }
      if (given(q.maxLength) || given(q.multiline) || given(q.example)) at('kind')()
      const accept = !given(q.accept) ? 'image' : (accepts[q.accept ?? ''] ?? at('accept')())
      return {
        ...base,
        ...none,
        required: q.required ?? false,
        accept,
        maxFiles: whole(q.maxFiles, 1, 1, 5, at('maxFiles')),
        price: cleanPrice(q.price, ['fixed', 'percent'], ctx, at('price')),
        choices: [],
      }
    })
    // One condition, on a choice of another choice list that is itself shown always, and nothing shown by a shown question.
    const targets = new Set(questions.flatMap((q) => (q.shownIf ? [q.shownIf.question] : [])))
    questions.forEach((q, qi) => {
      if (!q.shownIf) return
      const { question, choice } = q.shownIf
      const on = Number.isInteger(question) ? questions[question] : undefined
      if (!on || question === qi || on.kind !== 'choice' || on.shownIf || targets.has(qi) || !Number.isInteger(choice) || choice < 0 || choice >= on.choices.length) {
        throw new Invalid({ reason: 'INVALID_QUESTION', question: qi, choice: null, field: 'shownIf' })
      }
    })
    const ids = questions.flatMap((q) => (q.id ? [q.id] : []))
    const choiceIds = questions.flatMap((q) => q.choices.flatMap((c) => (c.id ? [c.id] : [])))
    if (new Set(ids).size !== ids.length || new Set(choiceIds).size !== choiceIds.length) return { reason: 'INVALID_QUESTION', question: 0, choice: null, field: 'id' }
    return questions
  } catch (error) {
    if (error instanceof Invalid) return error.refusal
    throw error
  }
}

/** Kept ids that aren't this product's questions, or a kept choice moved to another question: the save refuses them. */
export const foreignIds = (questions: readonly CleanQuestion[], existing: readonly QuestionRow[]): boolean => {
  const choicesOf = new Map(existing.map((q) => [q.id, new Set(q.choices.map((c) => c.id))]))
  return questions.some((q) => (q.id !== null && !choicesOf.has(q.id)) || q.choices.some((c) => c.id !== null && !(q.id !== null && choicesOf.get(q.id)?.has(c.id))))
}

/** The rows to write: ids kept or new, versions and conditions turned into ids. */
export const questionWrites = (questions: readonly CleanQuestion[], versionIds: readonly string[], newId: () => string): QuestionWrite[] => {
  const withIds = questions.map((q) => ({ ...q, id: q.id ?? newId(), choices: q.choices.map((c) => ({ ...c, id: c.id ?? newId() })) }))
  const amountsOf = (price: CleanPrice | null) => (price?.amounts ?? []).flatMap((a) => (a.version === null ? [{ currency: a.currency, amount: a.amount, versionId: null }] : versionIds[a.version] ? [{ currency: a.currency, amount: a.amount, versionId: versionIds[a.version] ?? null }] : []))
  return withIds.map((q, position) => ({
    id: q.id,
    kind: q.kind,
    label: q.label,
    help: q.help,
    required: q.required,
    position: position + 1,
    minPicks: q.minPicks,
    maxPicks: q.maxPicks,
    freePicks: q.freePicks,
    maxLength: q.maxLength,
    multiline: q.multiline,
    example: q.example,
    accept: q.accept,
    maxFiles: q.maxFiles,
    priceMode: q.price?.mode ?? null,
    priceBps: q.price?.bps ?? null,
    pricePer: q.price?.per ?? null,
    shownIfChoiceId: q.shownIf ? (withIds[q.shownIf.question]?.choices[q.shownIf.choice]?.id ?? null) : null,
    versionIds: q.versions.flatMap((v) => versionIds[v] ?? []),
    amounts: amountsOf(q.price),
    choices: q.choices.map((c, ci) => ({
      id: c.id,
      label: c.label,
      position: ci + 1,
      available: c.available,
      photoAssetId: c.photoAssetId,
      maxQuantity: c.maxQuantity,
      priceMode: c.price?.mode === 'per_character' ? null : (c.price?.mode ?? null),
      priceBps: c.price?.bps ?? null,
      pricePer: c.price?.per ?? null,
      amounts: amountsOf(c.price),
    })),
  }))
}

/** What sets an extra's charge (ACCESS §7.2): its price, per-version amounts, per item or line, and what multiplies it. */
type ChargeFacts = { price_mode: string | null; price_bps: number | null; price_per: string | null; amounts: readonly AmountRow[]; multipliers: string }
const priceKeyOf = (p: ChargeFacts | null) =>
  p?.price_mode ? `${p.price_mode}:${p.price_per}:${p.price_bps ?? ''}:${p.multipliers}:${p.amounts.map((a) => `${a.version_id ?? ''}/${a.currency}/${BigInt(a.amount)}`).sort().join(',')}` : ''
// A list's free allowance and a choice's quantity change what its choices charge; a per-character question's length its own.
const questionMultipliers = (q: { kind: string; price_mode: string | null; free_picks: number | null; max_length: number | null }) =>
  q.kind === 'choice' ? `free:${q.free_picks ?? 0}` : q.price_mode === 'per_character' ? `length:${q.max_length ?? 0}` : ''

const writeKey = (p: { priceMode: string | null; priceBps: number | null; pricePer: string | null; amounts: readonly { currency: string; amount: string; versionId: string | null }[] }, multipliers: string) =>
  priceKeyOf({ price_mode: p.priceMode, price_bps: p.priceBps, price_per: p.pricePer, amounts: p.amounts.map((a) => ({ currency: a.currency, amount: a.amount, version_id: a.versionId })), multipliers })

/**
 * ACCESS §7.2: an extra's price is a price, so adding, changing or removing one on a supplier's approved product sends it
 * back; text, order, conditions and availability don't. Compared by question and choice id: a new priced one is a change.
 */
export const extrasPriceChanged = (before: readonly QuestionRow[], after: readonly QuestionWrite[]): boolean => {
  const keys = (rows: readonly { id: string; key: string }[]) => new Map(rows.filter((r) => r.key !== '').map((r) => [r.id, r.key]))
  const was = keys(
    before.flatMap((q) => [
      { id: q.id, key: priceKeyOf({ ...q, multipliers: questionMultipliers(q) }) },
      ...q.choices.map((c: ChoiceRow) => ({ id: c.id, key: priceKeyOf({ ...c, multipliers: `${questionMultipliers(q)}:qty:${c.max_quantity}` }) })),
    ]),
  )
  const now = keys(
    after.flatMap((q) => {
      const m = questionMultipliers({ kind: q.kind, price_mode: q.priceMode, free_picks: q.freePicks, max_length: q.maxLength })
      return [{ id: q.id, key: writeKey(q, m) }, ...q.choices.map((c) => ({ id: c.id, key: writeKey(c, `${m}:qty:${c.maxQuantity}`) }))]
    }),
  )
  return was.size !== now.size || [...now].some(([id, key]) => was.get(id) !== key)
}

/**
 * Another product's questions as this one's (CATALOG U12): every question, choice, price and condition; a version's amount
 * or limit only where this product has a version with the same choices, a choice's photo only for the same owner. Answers
 * what couldn't come along.
 */
export const copiedQuestions = (
  source: readonly QuestionRow[],
  map: { versionOf: (sourceVersionId: string) => number | null; samePhotoOwner: boolean; currencies: ReadonlySet<string> },
): { questions: CleanQuestion[]; dropped: { amounts: number; versionLimits: number; photos: number } } => {
  const dropped = { amounts: 0, versionLimits: 0, photos: 0 }
  const choicePlace = new Map(source.flatMap((q, qi) => q.choices.map((c, ci) => [c.id, { question: qi, choice: ci }] as const)))
  const priceOf = (p: QuestionRow | ChoiceRow): CleanPrice | null => {
    if (!p.price_mode || !p.price_per) return null
    const amounts = p.amounts.flatMap((a): CleanAmount[] => {
      // An amount in a currency the target's owner couldn't type (a supplier types the pricing one only, fact 51).
      if (!map.currencies.has(a.currency)) {
        dropped.amounts += 1
        return []
      }
      if (a.version_id === null) return [{ currency: a.currency, amount: a.amount, version: null }]
      const version = map.versionOf(a.version_id)
      if (version === null) {
        dropped.amounts += 1
        return []
      }
      return [{ currency: a.currency, amount: a.amount, version }]
    })
    return { mode: p.price_mode, per: p.price_per, bps: p.price_bps, amounts }
  }
  const questions = source.map((q): CleanQuestion => {
    const versions = q.version_ids.flatMap((id) => {
      const version = map.versionOf(id)
      if (version === null) dropped.versionLimits += 1
      return version === null ? [] : [version]
    })
    return {
      id: null,
      kind: q.kind,
      label: q.label,
      help: q.help,
      required: q.required,
      minPicks: q.min_picks,
      maxPicks: q.max_picks,
      freePicks: q.free_picks,
      maxLength: q.max_length,
      multiline: q.multiline,
      example: q.example,
      accept: q.accept,
      maxFiles: q.max_files,
      price: priceOf(q),
      shownIf: q.shown_if_choice_id ? (choicePlace.get(q.shown_if_choice_id) ?? null) : null,
      // A limit to versions this product lacks altogether would hide the question from every version: it asks always.
      versions: q.version_ids.length > 0 && versions.length === 0 ? [] : versions,
      choices: q.choices.map((c) => {
        if (c.photo_asset_id && !map.samePhotoOwner) dropped.photos += 1
        return { id: null, label: c.label, photoAssetId: map.samePhotoOwner ? c.photo_asset_id : null, available: c.available, maxQuantity: c.max_quantity, price: priceOf(c) }
      }),
    }
  })
  return { questions, dropped }
}
