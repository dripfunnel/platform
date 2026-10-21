import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { TenantContext } from '#core/tenancy'
import { insertLicenceKeys, selectDownloadFile, selectProductKind, updateProductKind, type KindFields, type ProductKindRow } from '#db/scoped/catalogKinds'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { fillKeys } from '#engine/modules/deliveries/index'
import { selectStoreCountry } from '#db/scoped/orders'

// A download, a service and a gift card (CATALOG-DESIGN T14; FIRST-RELEASE §1, decided on #337): a file or a licence-key
// pool with how often and how long its link works; how long a service takes and where; when a gift card expires. Their
// amounts are the product's versions, priced as any other.

export const downloadLimits = [3, 5, 10] as const
export const downloadDays = [7, 30, 365] as const
export const maxKeysPerSave = 1000
export const maxGiftCardMonths = 120

/** The shortest a card may last from the day it is sent: 5 years in the US, 1 year elsewhere (decided 2026-10-05 on #337). */
export const shortestGiftCardMonths = (country: string | null): number => (country === 'US' ? 60 : 12)

export const kindsAudit = { saved: 'product.updated', keysAdded: 'product.licence_keys_added' } as const

export interface KindInput {
  download?: { mode: string; fileId?: string | null | undefined; limit: number; days: number } | null | undefined
  service?: { duration?: string | null | undefined; location?: string | null | undefined } | null | undefined
  /** `expiryMonths` null: never expires. */
  giftCard?: { expiryMonths?: number | null | undefined } | null | undefined
}

export type KindRefusal = 'INVALID_INPUT' | 'NOT_FOUND' | 'WRONG_KIND' | 'FILE_REFUSED' | 'EXPIRY_TOO_SHORT' | 'STALE_REVISION' | 'READ_ONLY'
export type KindResult<T> = { ok: true; value: T } | { ok: false; reason: KindRefusal }

export interface ProductKindView {
  productId: string
  productType: ProductKindRow['product_type']
  revision: number
  download: { mode: 'file' | 'keys'; file: { id: string; mime: string; bytes: number } | null; limit: number; days: number; keysLeft: number; keysSold: number } | null
  service: { duration: string | null; location: string | null } | null
  giftCard: { expiryMonths: number | null; shortestMonths: number } | null
}

const viewOf = (row: ProductKindRow, country: string | null): ProductKindView => ({
  productId: row.id,
  productType: row.product_type,
  revision: row.revision,
  download:
    row.product_type === 'digital'
      ? {
          mode: row.download_mode ?? 'file',
          file: row.download_asset_id && row.download_mime && row.download_bytes !== null ? { id: row.download_asset_id, mime: row.download_mime, bytes: row.download_bytes } : null,
          limit: row.download_limit,
          days: row.download_days,
          keysLeft: row.keys_left,
          keysSold: row.keys_sold,
        }
      : null,
  service: row.product_type === 'service' ? { duration: row.service_duration, location: row.service_location } : null,
  giftCard: row.product_type === 'gift_card' ? { expiryMonths: row.gift_card_expiry_months, shortestMonths: shortestGiftCardMonths(country) } : null,
})

const optional = (value: string | null | undefined, max: number): string | null | false => {
  const text = value?.trim() ?? ''
  return text === '' ? null : text.length > max ? false : text
}

/** What the kind's own card says, checked against the product's kind; the other kinds' fields stay as they were. */
export const cleanKind = (row: ProductKindRow, input: KindInput, country: string | null): KindFields | Exclude<KindRefusal, 'NOT_FOUND' | 'FILE_REFUSED' | 'STALE_REVISION' | 'READ_ONLY'> => {
  const given = [input.download ? 'digital' : null, input.service ? 'service' : null, input.giftCard ? 'gift_card' : null].filter((k) => k !== null)
  if (given.length !== 1) return 'INVALID_INPUT'
  if (given[0] !== row.product_type) return 'WRONG_KIND'
  const fields: KindFields = {
    downloadMode: row.download_mode,
    downloadAssetId: row.download_asset_id,
    downloadLimit: row.download_limit,
    downloadDays: row.download_days,
    serviceDuration: row.service_duration,
    serviceLocation: row.service_location,
    giftCardExpiryMonths: row.gift_card_expiry_months,
  }
  if (input.download) {
    const { mode, limit, days } = input.download
    const fileId = input.download.fileId?.toLowerCase() ?? null
    if ((mode !== 'file' && mode !== 'keys') || !(downloadLimits as readonly number[]).includes(limit) || !(downloadDays as readonly number[]).includes(days)) return 'INVALID_INPUT'
    if ((mode === 'keys') !== (fileId === null) || (fileId !== null && !isUuid(fileId))) return 'INVALID_INPUT'
    return { ...fields, downloadMode: mode, downloadAssetId: fileId, downloadLimit: limit, downloadDays: days }
  }
  if (input.service) {
    const duration = optional(input.service.duration, 60)
    const location = optional(input.service.location, 200)
    if (duration === false || location === false) return 'INVALID_INPUT'
    return { ...fields, serviceDuration: duration, serviceLocation: location }
  }
  const months = input.giftCard?.expiryMonths ?? null
  if (months !== null && (!Number.isInteger(months) || months > maxGiftCardMonths)) return 'INVALID_INPUT'
  if (months !== null && months < shortestGiftCardMonths(country)) return 'EXPIRY_TOO_SHORT'
  return { ...fields, giftCardExpiryMonths: months }
}

/** One key a line, trimmed, blank lines and repeats dropped; null when one is too long or there are too many. */
export const cleanKeys = (keys: readonly string[]): string[] | null => {
  const clean = [...new Set(keys.map((k) => k.trim()).filter((k) => k !== ''))]
  return clean.length === 0 || clean.length > maxKeysPerSave || clean.some((k) => k.length > 200) ? null : clean
}

export interface KindDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

class Refused extends Error {
  constructor(readonly reason: KindRefusal) {
    super(reason)
  }
}

export const createKindService = ({ sql, context, actor, activity, facts, now }: KindDeps) => {
  const { storeId } = context
  const record = (tx: ScopedSql, action: string, row: { id: string; name: string }, reason: string | null) =>
    activity.record(tx, {
      category: 'write',
      action,
      result: 'success',
      actorKind: 'person',
      actorId: actor.id,
      actorLabel: null,
      partnerId: actor.partnerId,
      storeId,
      target: { type: 'product', id: row.id, label: row.name },
      reason,
      api: 'store',
      visibility: 'store',
      ...facts,
    })

  const read = async (tx: ScopedSql, productId: string): Promise<ProductKindView | null> => {
    const row = isUuid(productId) ? await selectProductKind(tx, storeId, productId.toLowerCase()) : null
    return row ? viewOf(row, await selectStoreCountry(tx, storeId)) : null
  }

  const change = async (productId: string, work: (tx: ScopedSql, row: ProductKindRow, country: string | null) => Promise<void>): Promise<KindResult<ProductKindView>> => {
    if (context.caller.kind === 'support' && context.caller.access === 'read') return { ok: false, reason: 'READ_ONLY' }
    try {
      const value = await withScope(sql, context, async (tx) => {
        const row = isUuid(productId) ? await selectProductKind(tx, storeId, productId.toLowerCase()) : null
        if (!row) throw new Refused('NOT_FOUND')
        await work(tx, row, await selectStoreCountry(tx, storeId))
        const after = await read(tx, row.id)
        if (!after) throw new Refused('NOT_FOUND')
        return after
      })
      return { ok: true, value }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      throw error
    }
  }

  const kind = (productId: string) => withScope(sql, context, (tx) => read(tx, productId))

  const save = (productId: string, revision: number, input: KindInput) =>
    change(productId, async (tx, row, country) => {
      const fields = cleanKind(row, input, country)
      if (typeof fields === 'string') throw new Refused(fields)
      if (fields.downloadAssetId !== null && fields.downloadAssetId !== row.download_asset_id && !(await selectDownloadFile(tx, storeId, fields.downloadAssetId))) throw new Refused('FILE_REFUSED')
      if (!(await updateProductKind(tx, storeId, row.id, revision, fields, now()))) throw new Refused('STALE_REVISION')
      await record(tx, kindsAudit.saved, row, 'kind')
    })

  /** Keys added to a key-pool download; each paid unit takes one (CatEditor "one is sent per order"). */
  const addKeys = async (productId: string, keys: readonly string[]): Promise<KindResult<ProductKindView>> => {
    const added = await addToPool(productId, keys)
    if (!added.ok) return added
    // Paid orders the pool ran dry for take theirs first, in system scope as a payment's do.
    if ((await fillKeys(sql, storeId, added.value.productId, now())) === 0) return added
    const after = await kind(added.value.productId)
    return after ? { ok: true, value: after } : added
  }

  const addToPool = (productId: string, keys: readonly string[]) =>
    change(productId, async (tx, row) => {
      const clean = cleanKeys(keys)
      if (!clean) throw new Refused('INVALID_INPUT')
      if (row.product_type !== 'digital' || row.download_mode !== 'keys') throw new Refused('WRONG_KIND')
      const added = await insertLicenceKeys(tx, storeId, row.id, clean, actor.id)
      // The count, never a key (LOGGING §4).
      await record(tx, kindsAudit.keysAdded, row, String(added))
    })

  return { kind, save, addKeys }
}
