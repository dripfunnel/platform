import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { TenantContext } from '#core/tenancy'
import { approvalRequired, submitForApproval } from '#db/scoped/approval'
import { withScope, type ScopedSql } from '#db/scoped/index'
import {
  countUntranslatedProducts,
  deleteTranslations,
  selectEntityTranslation,
  selectLanguages,
  selectProductTranslation,
  selectSharedNames,
  slugClash,
  upsertTranslations,
  type SharedNameRow,
  type TranslationEntity,
  type TranslationField,
  type TranslationRow,
  type TranslationWrite,
} from '#db/scoped/translations'
import { approvalAudit } from './approval'
import { slugFrom } from './rules'

export type { SharedNameRow, TranslationRow } from '#db/scoped/translations'

// Translations (CATALOG facts 18–22, N): per language, beside the main text, which a missing one falls back to.
// A supplier translates its own products only (N15), and while approval is on its translation waits for it (N16).

export const translationAudit = {
  product: 'product.translated',
  shared: 'catalogue.names_translated',
  entity: 'catalogue.translated',
} as const

export type TranslationRefusal = 'NOT_FOUND' | 'NOT_A_TRANSLATION_LANGUAGE' | 'INVALID_INPUT' | 'INVALID_SLUG' | 'DUPLICATE_SLUG' | 'SUPPLIER_FIELD'
export type TranslationResult<T> = { ok: true; value: T } | { ok: false; reason: TranslationRefusal }

class Refused extends Error {
  constructor(readonly reason: TranslationRefusal) {
    super(reason)
  }
}

/** A field left out stays; null or empty clears it, so the main text shows again. */
export interface TextPatch {
  name?: string | null | undefined
  slug?: string | null | undefined
  description?: string | null | undefined
}

export interface ProductTranslationInput extends TextPatch {
  versions?: readonly { id: string; name: string | null }[] | null | undefined
  /** Option and choice names, once for the whole catalogue (N6): the merchant side's. */
  names?: readonly { kind: 'option_name' | 'choice_name'; source: string; text: string | null }[] | null | undefined
}

export interface TranslationDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

const limits: Record<TranslationField, number> = { name: 255, slug: 120, description: 20_000 }

export const createTranslationService = ({ sql, context, actor, activity, facts, now }: TranslationDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const entry = (action: string, target: { type: string; id: string; label: string }, reason: string | null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId,
    target,
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<TranslationResult<T>> => {
    try {
      return { ok: true, value: await inScope(work) }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      if (slugClash(error)) return { ok: false, reason: 'DUPLICATE_SLUG' }
      throw error
    }
  }

  /** One of the store's offered languages other than the main one (N13–N14). */
  const translating = async (tx: ScopedSql, language: string) => {
    const { main, active } = await selectLanguages(tx, storeId)
    if (language === main || !active.includes(language)) throw new Refused('NOT_A_TRANSLATION_LANGUAGE')
  }

  /** The writes and clears a patch makes against the rows it translates. */
  const changesOf = (rows: readonly TranslationRow[], entity: TranslationEntity, entityId: string, patch: TextPatch) => {
    const writes: TranslationWrite[] = []
    const clears: { entity: TranslationEntity; entityId: string; field: TranslationField }[] = []
    const main = (field: TranslationField) => rows.find((r) => r.entity === entity && r.entity_id === entityId && r.field === field)
    const put = (field: TranslationField, value: string | null | undefined) => {
      if (value === undefined) return
      const row = main(field)
      if (!row) return
      const text = (value ?? '').trim()
      if (text.length > limits[field]) throw new Refused('INVALID_INPUT')
      if (text === '') clears.push({ entity, entityId, field })
      else writes.push({ entity, entityId, field, main: row.main, text })
    }
    put('name', patch.name)
    put('description', patch.description)
    if (patch.slug !== undefined) {
      if (patch.slug && slugFrom(patch.slug) !== patch.slug) throw new Refused('INVALID_SLUG')
      put('slug', patch.slug)
    } else if (patch.name && !rows.some((r) => r.entity === entity && r.entity_id === entityId && r.field === 'slug' && r.text !== null)) {
      // Fact 22: made from the translated name; a name in a script with no Latin letters keeps the main one.
      const made = slugFrom(patch.name)
      if (made !== '') put('slug', made)
    }
    return { writes, clears }
  }

  const productTranslation = (productId: string, language: string) =>
    run(async (tx) => {
      await translating(tx, language)
      const rows = isUuid(productId) ? await selectProductTranslation(tx, storeId, productId, language) : []
      if (rows.length === 0) throw new Refused('NOT_FOUND')
      return rows
    })

  const saveProductTranslation = (productId: string, language: string, input: ProductTranslationInput) =>
    run(async (tx) => {
      await translating(tx, language)
      const rows = isUuid(productId) ? await selectProductTranslation(tx, storeId, productId, language) : []
      const product = rows.find((r) => r.entity === 'product' && r.field === 'name')
      if (!product) throw new Refused('NOT_FOUND')
      // Shared names are the whole catalogue's, so the merchant side's (N6, N15).
      if (sellerId !== null && input.names && input.names.length > 0) throw new Refused('SUPPLIER_FIELD')
      const own = changesOf(rows, 'product', productId, input)
      for (const v of input.versions ?? []) {
        const id = v.id.toLowerCase()
        if (!rows.some((r) => r.entity === 'version' && r.entity_id === id)) throw new Refused('NOT_FOUND')
        const change = changesOf(rows, 'version', id, { name: v.name })
        own.writes.push(...change.writes)
        own.clears.push(...change.clears)
      }
      for (const n of input.names ?? []) {
        const source = n.source.trim().toLowerCase()
        if (!rows.some((r) => r.entity === n.kind && r.entity_id === source)) throw new Refused('NOT_FOUND')
        const change = changesOf(rows, n.kind, source, { name: n.text })
        own.writes.push(...change.writes.map((w) => ({ ...w, main: source })))
        own.clears.push(...change.clears)
      }
      await upsertTranslations(tx, storeId, language, own.writes, now())
      await deleteTranslations(tx, storeId, language, own.clears)
      await activity.record(tx, entry(translationAudit.product, { type: 'product', id: productId, label: product.main }, language))
      // N16: a supplier's new translation waits for the merchant while approval is on.
      if (sellerId !== null && own.writes.length > 0 && (await approvalRequired(tx)) && (await submitForApproval(tx, storeId, productId))) {
        await activity.record(tx, entry(approvalAudit.sentBackForApproval, { type: 'product', id: productId, label: product.main }, 'translation'))
      }
      return await selectProductTranslation(tx, storeId, productId, language)
    })

  /** N7: a collection's, filter's or filter choice's text, the merchant side's. */
  const saveEntityTranslation = (entity: 'collection' | 'filter' | 'filter_value', id: string, language: string, patch: TextPatch) =>
    run(async (tx) => {
      await translating(tx, language)
      const rows = isUuid(id) ? await selectEntityTranslation(tx, storeId, entity, id, language) : []
      const named = rows.find((r) => r.field === 'name')
      if (!named) throw new Refused('NOT_FOUND')
      const change = changesOf(rows, entity, id, entity === 'collection' ? patch : { name: patch.name })
      await upsertTranslations(tx, storeId, language, change.writes, now())
      await deleteTranslations(tx, storeId, language, change.clears)
      await activity.record(tx, entry(translationAudit.entity, { type: entity, id, label: named.main }, language))
      return await selectEntityTranslation(tx, storeId, entity, id, language)
    })

  const entityTranslation = (entity: 'collection' | 'filter' | 'filter_value', id: string, language: string) =>
    run(async (tx) => {
      await translating(tx, language)
      const rows = isUuid(id) ? await selectEntityTranslation(tx, storeId, entity, id, language) : []
      if (rows.length === 0) throw new Refused('NOT_FOUND')
      return rows
    })

  /** N6's list: each option or choice name in the catalogue once, with how many products use it. */
  const sharedNames = (kind: 'option_name' | 'choice_name', language: string, window: { limit: number; after: string | null }) =>
    run(async (tx): Promise<SharedNameRow[]> => {
      await translating(tx, language)
      return selectSharedNames(tx, storeId, kind, language, { limit: window.limit, after: window.after === null ? null : { occurredAt: new Date(0), id: window.after }, before: null })
    })

  const saveSharedNames = (language: string, names: readonly { kind: 'option_name' | 'choice_name'; source: string; text: string | null }[]) =>
    run(async (tx) => {
      await translating(tx, language)
      const writes: TranslationWrite[] = []
      const clears: { entity: TranslationEntity; entityId: string; field: TranslationField }[] = []
      for (const n of names) {
        const source = n.source.trim().toLowerCase()
        const text = (n.text ?? '').trim()
        if (source === '' || source.length > 255 || text.length > 255) throw new Refused('INVALID_INPUT')
        if (text === '') clears.push({ entity: n.kind, entityId: source, field: 'name' })
        else writes.push({ entity: n.kind, entityId: source, field: 'name', main: source, text })
      }
      await upsertTranslations(tx, storeId, language, writes, now())
      await deleteTranslations(tx, storeId, language, clears)
      await activity.record(tx, entry(translationAudit.shared, { type: 'store', id: storeId, label: 'Option and choice names' }, `${language}: ${names.length}`))
      return true as const
    })

  /** Fact 19's progress: how many of the caller's products have no name in the language yet. */
  const counts = (language: string) =>
    run(async (tx) => {
      await translating(tx, language)
      return countUntranslatedProducts(tx, storeId, language)
    })

  return { productTranslation, saveProductTranslation, entityTranslation, saveEntityTranslation, sharedNames, saveSharedNames, counts }
}
