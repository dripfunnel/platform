import type postgres from 'postgres'
import { z } from 'zod'
import type { AssetStore } from '#engine/modules/catalog/index'
import {
  attachImportPhoto,
  catalogJobPayload,
  checkImport,
  collectionsRecomputeKind,
  createAssetService,
  createCatalogService,
  createTranslationService,
  failCatalogImport,
  importPhotoPayload,
  jobContextOf,
  runImportChunk,
  skipImportPhoto,
  type CatalogJobPayload,
  type ImportJobDeps,
  type PhotoFetch,
} from '#engine/modules/catalog/index'
import type { DnsLookup } from '#integrations/dns/doh'
import { fetchPublic } from '#integrations/http/publicFetch'
import { activityLog } from '#saas/activity/index'
import { allowanceFor } from '#saas/entitlements/index'
import { queueSideEffect } from '#saas/outbox/index'
import { defaultRelayOptions, type Deliverer, type Effect } from '../outbox-relay'

// `import.catalog` and `import.photos` (CATALOG K; FIRST-RELEASE §13): a catalogue import's check, its run a chunk at
// a time, and its photos one at a time, each in the importer's own scope and inside the relay's timeout.

/** A chunk stops taking products after this, leaving the rest of the relay's 10 seconds to save its progress. */
const chunkBudgetMs = 6_000
const maxPhotoBytes = 20 * 1024 * 1024

const jobPayload = catalogJobPayload.extend({ phase: z.enum(['check', 'run']) }).strict()
const photoPayload = catalogJobPayload.extend(importPhotoPayload.shape).strict()

/** The run's catalogue, translations and outbox, in the importer's own scope. */
export const catalogImportDeps = (sql: postgres.Sql, p: CatalogJobPayload, effect: Pick<Effect, 'id'>, now: () => Date): ImportJobDeps => {
  const context = jobContextOf(p)
  const actor = { id: p.caller.kind === 'support' ? p.caller.partnerUserId : p.caller.userId, partnerId: p.partnerId }
  const facts = { requestId: effect.id, ip: null, userAgent: null }
  const catalog = createCatalogService({
    sql,
    context,
    actor,
    activity: activityLog,
    facts,
    now,
    productAllowance: () => allowanceFor(sql, context, 'products', now()),
    recompute: (tx) => queueSideEffect(tx, { kind: collectionsRecomputeKind, idempotencyKey: crypto.randomUUID(), payload: { storeId: p.storeId }, partnerId: p.partnerId, storeId: p.storeId }),
  })
  const translations = createTranslationService({ sql, context, actor, activity: activityLog, facts, now })
  return {
    sql,
    context,
    actor,
    activity: activityLog,
    facts,
    now,
    catalog,
    saveTranslation: translations.saveProductTranslation,
    queue: (tx, kind, key, payload) => queueSideEffect(tx, { kind, idempotencyKey: key, payload, partnerId: p.partnerId, storeId: p.storeId }),
  }
}

const failingLast = async (sql: postgres.Sql, p: CatalogJobPayload, effect: Effect, now: () => Date, work: () => Promise<void>) => {
  try {
    await work()
  } catch (error) {
    if (effect.attempt >= defaultRelayOptions.maxAttempts) await failCatalogImport({ sql, context: jobContextOf(p), now }, p.jobId)
    throw error
  }
}

export const catalogImportDeliverer = (sql: postgres.Sql, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = jobPayload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('import.catalog: bad payload')
    const p = parsed.data
    const deps = catalogImportDeps(sql, p, effect, now)
    await failingLast(sql, p, effect, now, () => (p.phase === 'check' ? checkImport(deps, p.jobId) : runImportChunk(deps, p.jobId, chunkBudgetMs)))
  },
})

/** A photo is fetched from a public address only (publicFetch.ts) and stored as the importer's own file. */
export const importPhotosDeliverer = (sql: postgres.Sql, assets: AssetStore | null, lookup: DnsLookup, now: () => Date = () => new Date(), fetchImpl?: typeof fetch): Deliverer => ({
  deliver: async (effect) => {
    const parsed = photoPayload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('import.photos: bad payload')
    const p = parsed.data
    const deps = catalogImportDeps(sql, p, effect, now)
    const fetchPhoto: PhotoFetch = async (url) => {
      if (!assets) return { ok: false, code: 'PHOTO_UNAVAILABLE' }
      const got = await fetchPublic(url, { lookup, maxBytes: maxPhotoBytes, timeoutMs: 3_500, tries: 2, ...(fetchImpl ? { fetchImpl } : {}) })
      if (!got.ok) return { ok: false, code: got.code === 'TOO_LARGE' ? 'PHOTO_REFUSED' : 'PHOTO_UNAVAILABLE' }
      const stored = await createAssetService({ sql, context: deps.context, actor: deps.actor, activity: activityLog, facts: deps.facts, store: assets }).upload(got.bytes)
      return stored.ok && stored.asset.kind === 'image' ? { ok: true, assetId: stored.asset.id } : { ok: false, code: 'PHOTO_REFUSED' }
    }
    // A photo is a line of the import, not its end: after the last attempt it's reported and the run goes on (K6).
    try {
      await attachImportPhoto(deps, p.jobId, p, fetchPhoto)
    } catch (error) {
      if (effect.attempt >= defaultRelayOptions.maxAttempts) return skipImportPhoto(deps, p.jobId, p)
      throw error
    }
  },
})
