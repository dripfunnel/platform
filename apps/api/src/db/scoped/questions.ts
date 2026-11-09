import type postgres from 'postgres'
import { pgArray, type ScopedSql } from './index'

// A product's questions (migration 0391; DATA-MODEL §7.3), read and written by the caller's own policies: the merchant side
// any product's, a supplier its own products'. Rows go as one jsonb parameter, read with jsonb_to_recordset (catalog.ts).

const rowsOf = (tx: ScopedSql, rows: readonly object[]) => tx.json(rows as unknown as postgres.JSONValue)

export type QuestionKind = 'choice' | 'text' | 'upload'
export type PriceMode = 'fixed' | 'percent' | 'per_character'
export type PricePer = 'item' | 'line'

export interface AmountRow {
  currency: string
  /** Minor units, as a string (bigint). */
  amount: string
  /** Null: the amount for every version. */
  version_id: string | null
}

export interface PriceRow {
  price_mode: PriceMode | null
  price_bps: number | null
  price_per: PricePer | null
  amounts: AmountRow[]
}

export interface ChoiceRow extends PriceRow {
  id: string
  label: string
  position: number
  available: boolean
  photo_asset_id: string | null
  max_quantity: number
}

export interface QuestionRow extends PriceRow {
  id: string
  product_id: string
  kind: QuestionKind
  label: string
  help: string | null
  required: boolean
  position: number
  min_picks: number | null
  max_picks: number | null
  free_picks: number | null
  max_length: number | null
  multiline: boolean | null
  example: string | null
  accept: 'image' | 'pdf' | 'image_pdf' | null
  max_files: number | null
  shown_if_choice_id: string | null
  /** Empty: every version. */
  version_ids: string[]
  choices: ChoiceRow[]
}

/** Each product's questions in order, its choices in order; a product without any is missing from the map. */
export const selectProductQuestions = async (tx: ScopedSql, productIds: readonly string[]): Promise<Map<string, QuestionRow[]>> => {
  if (productIds.length === 0) return new Map()
  const rows = await tx<QuestionRow[]>`
    select q.id, q.product_id, q.kind, q.label, q.help, q.required, q.position, q.min_picks, q.max_picks, q.free_picks, q.max_length,
      q.multiline, q.example, q.accept, q.max_files, q.price_mode, q.price_bps, q.price_per, q.shown_if_choice_id,
      coalesce((select json_agg(v.version_id order by v.version_id) from product_question_version v join product_version pv on pv.id = v.version_id and pv.deleted_at is null
        where v.question_id = q.id), '[]'::json) as version_ids,
      coalesce((select json_agg(json_build_object('currency', a.currency, 'amount', a.amount::text, 'version_id', a.version_id) order by a.version_id nulls first, a.currency)
        from product_question_amount a where a.question_id = q.id and (a.version_id is null or exists (select 1 from product_version pv where pv.id = a.version_id and pv.deleted_at is null))), '[]'::json) as amounts,
      coalesce((select json_agg(json_build_object('id', c.id, 'label', c.label, 'position', c.position, 'available', c.available, 'photo_asset_id', c.photo_asset_id,
          'max_quantity', c.max_quantity, 'price_mode', c.price_mode, 'price_bps', c.price_bps, 'price_per', c.price_per,
          'amounts', coalesce((select json_agg(json_build_object('currency', a.currency, 'amount', a.amount::text, 'version_id', a.version_id) order by a.version_id nulls first, a.currency)
            from product_question_amount a where a.choice_id = c.id and (a.version_id is null or exists (select 1 from product_version pv where pv.id = a.version_id and pv.deleted_at is null))), '[]'::json)) order by c.position)
        from product_question_choice c where c.question_id = q.id), '[]'::json) as choices
    from product_question q
    where q.product_id = any (${pgArray(productIds)}::uuid[])
    order by q.product_id, q.position
  `
  const byProduct = new Map<string, QuestionRow[]>()
  for (const row of rows) byProduct.set(row.product_id, [...(byProduct.get(row.product_id) ?? []), row])
  return byProduct
}

/** Whether the store has an undeleted product with questions (OFFERS-DESIGN §3.1's switch). */
export const storeHasQuestions = async (tx: ScopedSql, storeId: string): Promise<boolean> =>
  (await tx<{ ok: boolean }[]>`
    select exists (select 1 from product_question q join product p on p.id = q.product_id where q.store_id = ${storeId} and p.deleted_at is null) as ok
  `)[0]?.ok ?? false

export interface AmountWrite {
  currency: string
  amount: string
  versionId: string | null
}

export interface ChoiceWrite {
  id: string
  label: string
  position: number
  available: boolean
  photoAssetId: string | null
  maxQuantity: number
  priceMode: 'fixed' | 'percent' | null
  priceBps: number | null
  pricePer: PricePer | null
  amounts: AmountWrite[]
}

export interface QuestionWrite {
  id: string
  kind: QuestionKind
  label: string
  help: string | null
  required: boolean
  position: number
  minPicks: number | null
  maxPicks: number | null
  freePicks: number | null
  maxLength: number | null
  multiline: boolean | null
  example: string | null
  accept: 'image' | 'pdf' | 'image_pdf' | null
  maxFiles: number | null
  priceMode: PriceMode | null
  priceBps: number | null
  pricePer: PricePer | null
  shownIfChoiceId: string | null
  versionIds: string[]
  amounts: AmountWrite[]
  choices: ChoiceWrite[]
}

const questionColumns = (q: QuestionWrite) => ({
  id: q.id, kind: q.kind, label: q.label, help: q.help, required: q.required, position: q.position, minPicks: q.minPicks, maxPicks: q.maxPicks,
  freePicks: q.freePicks, maxLength: q.maxLength, multiline: q.multiline, example: q.example, accept: q.accept, maxFiles: q.maxFiles,
  priceMode: q.priceMode, priceBps: q.priceBps, pricePer: q.pricePer,
})
const choiceColumns = (c: ChoiceWrite & { questionId: string }) => ({
  id: c.id, questionId: c.questionId, label: c.label, position: c.position, available: c.available, photoAssetId: c.photoAssetId,
  maxQuantity: c.maxQuantity, priceMode: c.priceMode, priceBps: c.priceBps, pricePer: c.pricePer,
})

/**
 * The product's questions become exactly these, matched by id so a cart's answers keep naming them: removed ones go, kept
 * ones change in place, new ones are added. Conditions are set last, once every choice they may name exists.
 */
export const setProductQuestions = async (tx: ScopedSql, storeId: string, productId: string, questions: readonly QuestionWrite[]): Promise<void> => {
  const questionIds = questions.map((q) => q.id)
  const choices = questions.flatMap((q) => q.choices.map((c) => ({ ...c, questionId: q.id })))
  const amounts = [
    ...questions.flatMap((q) => q.amounts.map((a) => ({ ...a, questionId: q.id, choiceId: null }))),
    ...choices.flatMap((c) => c.amounts.map((a) => ({ ...a, questionId: null, choiceId: c.id }))),
  ]
  const versions = questions.flatMap((q) => q.versionIds.map((versionId) => ({ questionId: q.id, versionId })))
  await tx`delete from product_question where product_id = ${productId} and not (id = any (${pgArray(questionIds)}::uuid[]))`
  if (questions.length === 0) return
  await tx`
    insert into product_question (id, product_id, store_id, kind, label, help, required, position, min_picks, max_picks, free_picks, max_length, multiline,
      example, accept, max_files, price_mode, price_bps, price_per)
    select x.id, ${productId}, ${storeId}, x.kind, x.label, x.help, x.required, x.position, x."minPicks", x."maxPicks", x."freePicks", x."maxLength",
      x.multiline, x.example, x.accept, x."maxFiles", x."priceMode", x."priceBps", x."pricePer"
    from jsonb_to_recordset(${rowsOf(tx, questions.map(questionColumns))}) as x(
      id uuid, kind text, label text, help text, required boolean, position smallint, "minPicks" smallint, "maxPicks" smallint, "freePicks" smallint,
      "maxLength" smallint, multiline boolean, example text, accept text, "maxFiles" smallint, "priceMode" text, "priceBps" integer, "pricePer" text)
    on conflict (id) do update set kind = excluded.kind, label = excluded.label, help = excluded.help, required = excluded.required, position = excluded.position,
      min_picks = excluded.min_picks, max_picks = excluded.max_picks, free_picks = excluded.free_picks, max_length = excluded.max_length,
      multiline = excluded.multiline, example = excluded.example, accept = excluded.accept, max_files = excluded.max_files,
      price_mode = excluded.price_mode, price_bps = excluded.price_bps, price_per = excluded.price_per, shown_if_choice_id = null
      where product_question.product_id = ${productId}
  `
  await tx`
    delete from product_question_choice where question_id = any (${pgArray(questionIds)}::uuid[]) and not (id = any (${pgArray(choices.map((c) => c.id))}::uuid[]))
  `
  if (choices.length > 0) {
    await tx`
      insert into product_question_choice (id, question_id, product_id, store_id, label, position, available, photo_asset_id, max_quantity, price_mode, price_bps, price_per)
      select x.id, x."questionId", ${productId}, ${storeId}, x.label, x.position, x.available, x."photoAssetId", x."maxQuantity", x."priceMode", x."priceBps", x."pricePer"
      from jsonb_to_recordset(${rowsOf(tx, choices.map(choiceColumns))}) as x(
        id uuid, "questionId" uuid, label text, position smallint, available boolean, "photoAssetId" uuid, "maxQuantity" smallint, "priceMode" text, "priceBps" integer, "pricePer" text)
      on conflict (id) do update set label = excluded.label, position = excluded.position, available = excluded.available, photo_asset_id = excluded.photo_asset_id,
        max_quantity = excluded.max_quantity, price_mode = excluded.price_mode, price_bps = excluded.price_bps, price_per = excluded.price_per
        where product_question_choice.question_id = excluded.question_id
    `
  }
  await tx`delete from product_question_amount where product_id = ${productId}`
  await tx`delete from product_question_version where product_id = ${productId}`
  if (amounts.length > 0) {
    await tx`
      insert into product_question_amount (store_id, product_id, question_id, choice_id, version_id, currency, amount)
      select ${storeId}, ${productId}, x."questionId", x."choiceId", x."versionId", x.currency, x.amount
      from jsonb_to_recordset(${rowsOf(tx, amounts)}) as x("questionId" uuid, "choiceId" uuid, "versionId" uuid, currency text, amount bigint)
    `
  }
  if (versions.length > 0) {
    await tx`
      insert into product_question_version (question_id, version_id, product_id, store_id)
      select x."questionId", x."versionId", ${productId}, ${storeId} from jsonb_to_recordset(${rowsOf(tx, versions)}) as x("questionId" uuid, "versionId" uuid)
    `
  }
  const conditions = questions.filter((q) => q.shownIfChoiceId !== null).map((q) => ({ id: q.id, choiceId: q.shownIfChoiceId }))
  if (conditions.length > 0) {
    await tx`
      update product_question q set shown_if_choice_id = x."choiceId"
      from jsonb_to_recordset(${rowsOf(tx, conditions)}) as x(id uuid, "choiceId" uuid) where q.id = x.id and q.product_id = ${productId}
    `
  }
}

/** A question row the engine's own checks should have stopped (a condition two deep, a choice on a text question). */
export const questionRefused = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && /catalogue: (no such question|only a choice list|that version is another product|a question is shown)/.test(error.message)

/** The currencies the merchant side types its own amounts in (store_currency, manual and active). */
export const manualCurrencies = async (tx: ScopedSql, storeId: string): Promise<string[]> =>
  (await tx<{ currency: string }[]>`select currency from store_currency where store_id = ${storeId} and mode = 'manual' and status = 'active'`).map((r) => r.currency)

/** A save that changed only the questions moves the product's revision as any save does (CATALOG E4); null when stale. */
export const touchProduct = async (tx: ScopedSql, storeId: string, id: string, revision: number, now: Date): Promise<{ slug: string } | null> =>
  (await tx<{ slug: string }[]>`
    update product set updated_at = ${now}, revision = revision + 1 where id = ${id} and store_id = ${storeId} and revision = ${revision} and deleted_at is null returning slug
  `)[0] ?? null

/** The shopper's language's words for these questions and choices, by `${entity}:${id}:${field}` (CATALOG fact 18). */
export const selectQuestionWords = async (tx: ScopedSql, storeId: string, ids: readonly string[], language: string): Promise<Map<string, string>> => {
  if (ids.length === 0) return new Map()
  const rows = await tx<{ entity: string; entity_id: string; field: string; text: string }[]>`
    select entity, entity_id, field, text from translation
    where store_id = ${storeId} and language = ${language} and entity in ('question', 'question_choice') and entity_id = any (${pgArray(ids)}::text[])
  `
  return new Map(rows.map((r) => [`${r.entity}:${r.entity_id}:${r.field}`, r.text]))
}

/** An upload question of a product the shopper can see, with what it accepts; null for any other id (the shop policy decides). */
export const selectShopUploadQuestion = async (tx: ScopedSql, id: string): Promise<{ id: string; accept: 'image' | 'pdf' | 'image_pdf' } | null> =>
  (await tx<{ id: string; accept: 'image' | 'pdf' | 'image_pdf' }[]>`select id, accept from product_question where id = ${id} and kind = 'upload'`)[0] ?? null
