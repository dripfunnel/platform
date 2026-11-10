import { z } from 'zod'
import { moneySchema, type Money } from '../pricing/money'
import { moneyFields } from './summary'

// A product's questions (CATALOG-DESIGN §3 facts 49–57; storefront ARCHITECTURE §3.5 "The customisation modal"): the Shop
// API's `ShopProduct.questions`, decoded, and which of them a version asks given what is picked so far.

const priceFields = `mode per percentBps amount { ${moneyFields} }`
export const questionFields = `questions { id kind label help required minPicks maxPicks freePicks maxLength multiline example accept maxFiles versionIds shownIf { questionId choiceId } price { ${priceFields} } choices { id label available maxQuantity photo { url } price { ${priceFields} } } }`

const text = z.string().nullable().optional()
const count = z.number().int().nullable().optional()
const priceSchema = z
  .object({ mode: text, per: text, percentBps: count, amount: moneySchema.nullable().optional().catch(null) })
  .nullable()
  .optional()
const questionSchema = z.object({
  id: text,
  kind: text,
  label: text,
  help: text,
  required: z.boolean().nullable().optional(),
  minPicks: count,
  maxPicks: count,
  freePicks: count,
  maxLength: count,
  multiline: z.boolean().nullable().optional(),
  example: text,
  accept: text,
  maxFiles: count,
  versionIds: z.array(z.string()).nullable().optional(),
  shownIf: z.object({ questionId: text, choiceId: text }).nullable().optional(),
  price: priceSchema,
  choices: z.array(z.object({ id: text, label: text, available: z.boolean().nullable().optional(), maxQuantity: count, photo: z.object({ url: text }).nullable().optional(), price: priceSchema })).nullable().optional(),
})
export const questionsSchema = z.array(questionSchema).nullable().optional()

/** An extra's price as the shop reads it: `amount` null where it isn't sold in the cart's currency. */
export type ExtraPrice = { mode: 'FIXED' | 'PERCENT' | 'PER_CHARACTER'; per: 'ITEM' | 'LINE'; percentBps: number | null; amount: Money | null }
export type QuestionChoice = { id: string; label: string; available: boolean; maxQuantity: number; photoUrl: string | null; price: ExtraPrice | null }
export type Question = {
  id: string
  kind: 'CHOICE' | 'TEXT' | 'UPLOAD'
  label: string
  help: string | null
  required: boolean
  minPicks: number
  maxPicks: number
  freePicks: number
  maxLength: number
  multiline: boolean
  example: string | null
  accept: 'IMAGE' | 'PDF' | 'IMAGE_PDF'
  maxFiles: number
  /** Null: every version. */
  versionIds: string[] | null
  shownIf: { questionId: string; choiceId: string } | null
  price: ExtraPrice | null
  choices: QuestionChoice[]
}

const priceOf = (p: z.infer<typeof priceSchema>): ExtraPrice | null => {
  const mode = (['FIXED', 'PERCENT', 'PER_CHARACTER'] as const).find((m) => m === p?.mode)
  return p && mode ? { mode, per: p.per === 'LINE' ? 'LINE' : 'ITEM', percentBps: p.percentBps ?? null, amount: p.amount ?? null } : null
}

/** The questions with what the shop needs of each; one without an id, a label or a known kind is left out. */
export const decodeQuestions = (raw: z.infer<typeof questionsSchema>): Question[] =>
  (raw ?? []).flatMap((q): Question[] => {
    const kind = (['CHOICE', 'TEXT', 'UPLOAD'] as const).find((k) => k === q.kind)
    if (!q.id || !q.label || !kind) return []
    const shownIf = q.shownIf?.questionId && q.shownIf.choiceId ? { questionId: q.shownIf.questionId, choiceId: q.shownIf.choiceId } : null
    return [
      {
        id: q.id,
        kind,
        label: q.label,
        help: q.help ?? null,
        required: q.required ?? false,
        minPicks: q.minPicks ?? 0,
        maxPicks: q.maxPicks ?? 1,
        freePicks: q.freePicks ?? 0,
        maxLength: q.maxLength ?? 100,
        multiline: q.multiline ?? false,
        example: q.example ?? null,
        accept: (['IMAGE', 'PDF', 'IMAGE_PDF'] as const).find((a) => a === q.accept) ?? 'IMAGE',
        maxFiles: q.maxFiles ?? 1,
        versionIds: q.versionIds ?? null,
        shownIf,
        price: priceOf(q.price),
        choices: (q.choices ?? []).flatMap((c) => (c.id && c.label ? [{ id: c.id, label: c.label, available: c.available ?? true, maxQuantity: c.maxQuantity ?? 1, photoUrl: c.photo?.url ?? null, price: priceOf(c.price) }] : [])),
      },
    ]
  })

/** What the shopper has answered, as the Shop API's `ShopAnswerInput` takes it. */
export type Answer = { questionId: string; choices?: { choiceId: string; quantity: number }[]; text?: string; uploadIds?: string[] }

// The product page's questions by version, so Add to cart and Buy now know to ask (they hold only a version id).
const byVersion = new Map<string, { productId: string; name: string; questions: Question[] }>()

/** Remembers a product's questions for each of its versions; a product without any forgets them. */
export const rememberQuestions = (product: { id: string; name: string; versionIds: readonly string[]; questions: readonly Question[] }) => {
  for (const v of product.versionIds) {
    if (product.questions.length > 0) byVersion.set(v, { productId: product.id, name: product.name, questions: [...product.questions] })
    else byVersion.delete(v)
  }
}

/** The questions a version's product asks, or null when the page didn't load any for it. */
export const questionsForVersion = (versionId: string) => byVersion.get(versionId) ?? null
