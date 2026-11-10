import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import type { Price } from './catalogue'

// Product customisation in the Shop API (CATALOG-DESIGN §3 facts 49–57; PLATFORM-PROMPT §5.4; #1373): a product's questions,
// the live quote, adding and editing a line's answers, and the shopper's files. Every amount is the engine's.

export type ExtraPrice = { mode: 'FIXED' | 'PERCENT' | 'PER_CHARACTER'; per: 'ITEM' | 'LINE'; percentBps: number | null; amount: Price | null }
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
  versionIds: string[] | null
  shownIf: { questionId: string; choiceId: string } | null
  price: ExtraPrice | null
  choices: QuestionChoice[]
}

/** As the Shop API's `ShopAnswerInput` takes it. */
export type Answer = { questionId: string; choices?: { choiceId: string; quantity: number }[]; text?: string; uploadIds?: string[] }

const priceFields = 'mode per percentBps amount { amount currency }'
export const questionFields = `questions { id kind label help required minPicks maxPicks freePicks maxLength multiline example accept maxFiles versionIds shownIf { questionId choiceId } price { ${priceFields} } choices { id label available maxQuantity photo { url } price { ${priceFields} } } }`

const text = z.string().nullable().optional()
const count = z.number().int().nullable().optional()
const money = z.object({ amount: z.string(), currency: z.string() }).nullable().optional()
const priceSchema = z.object({ mode: text, per: text, percentBps: count, amount: money }).nullable().optional()
export const questionsSchema = z
  .array(
    z.object({
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
    }),
  )
  .nullable()
  .optional()

const priceOf = (p: z.infer<typeof priceSchema>): ExtraPrice | null => {
  const mode = (['FIXED', 'PERCENT', 'PER_CHARACTER'] as const).find((m) => m === p?.mode)
  return p && mode ? { mode, per: p.per === 'LINE' ? 'LINE' : 'ITEM', percentBps: p.percentBps ?? null, amount: p.amount ?? null } : null
}

/** The questions the app can show; one without an id, a label or a known kind is left out. */
export const questionsOf = (raw: z.infer<typeof questionsSchema>): Question[] =>
  (raw ?? []).flatMap((q): Question[] => {
    const kind = (['CHOICE', 'TEXT', 'UPLOAD'] as const).find((k) => k === q.kind)
    if (!q.id || !q.label || !kind) return []
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
        shownIf: q.shownIf?.questionId && q.shownIf.choiceId ? { questionId: q.shownIf.questionId, choiceId: q.shownIf.choiceId } : null,
        price: priceOf(q.price),
        choices: (q.choices ?? []).flatMap((c) => (c.id && c.label ? [{ id: c.id, label: c.label, available: c.available ?? true, maxQuantity: c.maxQuantity ?? 1, photoUrl: c.photo?.url ?? null, price: priceOf(c.price) }] : [])),
      },
    ]
  })

/** The questions a version asks, given the answers so far: its versions, and a condition's choice picked (fact 54). */
export const askedFor = (questions: readonly Question[], versionId: string, answers: readonly Answer[]): Question[] => {
  const picked = new Set(answers.flatMap((a) => (a.choices ?? []).filter((c) => c.quantity > 0).map((c) => c.choiceId)))
  return questions.filter((q) => (q.versionIds === null || q.versionIds.includes(versionId)) && (q.shownIf === null || picked.has(q.shownIf.choiceId)))
}

/** Only answers to questions still asked, with nothing empty. */
export const answersToSend = (questions: readonly Question[], versionId: string, answers: readonly Answer[]): Answer[] => {
  const asked = new Set(askedFor(questions, versionId, answers).map((q) => q.id))
  return answers.flatMap((a): Answer[] => {
    if (!asked.has(a.questionId)) return []
    const choices = (a.choices ?? []).filter((c) => c.quantity > 0)
    if (choices.length > 0) return [{ questionId: a.questionId, choices }]
    if (a.text !== undefined && a.text.trim() !== '') return [{ questionId: a.questionId, text: a.text }]
    if (a.uploadIds && a.uploadIds.length > 0) return [{ questionId: a.questionId, uploadIds: a.uploadIds }]
    return []
  })
}

export type QuoteProblem = { questionId: string | null; reason: string }
export type Quote = { lineTotal: Price | null; problems: QuoteProblem[] }

/** The line as it would be priced with these answers (the sheet's live total), writing nothing. */
export const quote = async (client: ApiClient, versionId: string, quantity: number, answers: readonly Answer[]): Promise<Quote> => {
  const { customisationQuote: q } = decode(
    z.object({ customisationQuote: z.object({ lineTotal: money, problems: z.array(z.object({ questionId: text, reason: text })).nullable().optional() }).nullable() }),
    await client.request<unknown>(
      'query($versionId: ID!, $quantity: Int!, $answers: [ShopAnswerInput!]!) { customisationQuote(versionId: $versionId, quantity: $quantity, answers: $answers) { lineTotal { amount currency } problems { questionId reason } } }',
      { versionId, quantity, answers },
    ),
  )
  return { lineTotal: q?.lineTotal ?? null, problems: (q?.problems ?? []).map((p) => ({ questionId: p.questionId ?? null, reason: p.reason ?? 'UNKNOWN' })) }
}

/** Adds the version with its answers; answers a guest's cart token. */
export const addWithAnswers = async (client: ApiClient, versionId: string, quantity: number, answers: readonly Answer[]): Promise<string | null> =>
  decode(
    z.object({ addToCart: z.object({ cartToken: text }).nullable() }),
    await client.request<unknown>('mutation($versionId: ID!, $quantity: Int!, $answers: [ShopAnswerInput!]) { addToCart(versionId: $versionId, quantity: $quantity, answers: $answers) { cartToken } }', { versionId, quantity, answers }),
  ).addToCart?.cartToken ?? null

export type UploadResult = { ok: true; id: string; cartToken: string | null } | { ok: false; code: string }

const codeOf = (body: string): string => {
  try {
    return (JSON.parse(body) as { errors?: { extensions?: { code?: string } }[] }).errors?.[0]?.extensions?.code ?? 'UNKNOWN'
  } catch {
    return 'UNKNOWN'
  }
}

/** Sends one picked file to `POST /shop-api/uploads` with the shop's headers, telling `onProgress` the share sent (0–1). */
export const uploadFile = async (host: string, headers: Record<string, string>, questionId: string, file: { uri: string; mime: string }, onProgress: (sent: number) => void): Promise<UploadResult> => {
  let body: Blob
  try {
    body = await (await fetch(file.uri)).blob()
  } catch {
    return { ok: false, code: 'NO_RESPONSE' }
  }
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `https://${host}/shop-api/uploads?question=${encodeURIComponent(questionId)}`)
    for (const [name, value] of Object.entries({ ...headers, 'content-type': file.mime })) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total)
    xhr.onerror = () => resolve({ ok: false, code: 'NO_RESPONSE' })
    xhr.onload = () => {
      if (xhr.status !== 200) return resolve({ ok: false, code: codeOf(xhr.responseText) })
      try {
        const answer = JSON.parse(xhr.responseText) as { id?: string; cartToken?: string | null }
        resolve(answer.id ? { ok: true, id: answer.id, cartToken: answer.cartToken ?? null } : { ok: false, code: 'BAD_RESPONSE' })
      } catch {
        resolve({ ok: false, code: 'BAD_RESPONSE' })
      }
    }
    xhr.send(body)
  })
}

/** Removes a file no line names yet; null once gone, else the refusal's code (UPLOAD_IN_USE, …). */
export const removeFile = async (host: string, headers: Record<string, string>, id: string): Promise<string | null> => {
  try {
    const response = await fetch(`https://${host}/shop-api/uploads/${encodeURIComponent(id)}`, { method: 'DELETE', headers })
    return response.ok ? null : codeOf(await response.text())
  } catch {
    return 'NO_RESPONSE'
  }
}
