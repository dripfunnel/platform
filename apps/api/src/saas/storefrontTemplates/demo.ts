import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog } from '#auth/activity'
import type { TenantContext } from '#core/tenancy'
import { insertAsset } from '#db/scoped/catalog'
import { insertDemoOwner, insertDemoStore, lockDemoTemplate, selectDemoStore, selectHousePartner, setDemoLogo, setTemplateDemo, type DemoStoreRow } from '#db/scoped/demoStores'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { freeStoreCode } from '#db/scoped/partnerCreateStore'
import { upsertDesignDraft } from '#db/scoped/storefronts'
import { createCatalogImportService, type AssetStore } from '#engine/modules/catalog/index'
import { queueSideEffect } from '#saas/outbox/index'
import { createStoreCategoryService } from '#saas/storeCategories/index'
import { previewFolder } from '#saas/storefronts/layout'
import { copyTemplatePreview, currentCore, type SitesBucket } from '#saas/storefronts/templates'
import { freeStoreSlug } from '#saas/stores/slug'
import { demoLogoPng } from './demoLogo'

// A category template's demo store (admin FIRST-RELEASE §11d): made once, in system scope, then filled by the
// `template.demo` job with the fixed name and logo, the category's sample and the template's ready-built preview.

export const demoTemplateKind = 'template.demo'
export const demoParams = z.strictObject({ storeId: z.guid(), template: z.string().regex(/^[a-z0-9-]{1,40}$/) })
export type DemoParams = z.infer<typeof demoParams>

export const demoName = 'Shopstore'
const demoEmail = (key: string) => `demo-${key}@demo.dripfunnel.invalid`
/** The preview's folder name: a demo has one preview, never replaced by a studio change. */
const demoPreviewRef = 'demo'
/** A demo's draft has no commit: no repo is ever made for it (`design_draft.head_commit` is required). */
const noCommit = '0'.repeat(40)

export type StartDemo = { ok: true; storeId: string; created: boolean } | { ok: false; code: 'NOT_FOUND' | 'NO_SAMPLE' | 'NO_HOUSE_PARTNER' }

/** The template's demo store, made with its owner and its fill queued the first time; `tx` is in system scope. */
export const startDemo = async (tx: ScopedSql, key: string, at: Date): Promise<StartDemo> => {
  const template = await lockDemoTemplate(tx, key)
  if (!template?.category_id) return { ok: false, code: 'NOT_FOUND' }
  if (template.demo_store_id) return { ok: true, storeId: template.demo_store_id, created: false }
  if (!template.currency) return { ok: false, code: 'NO_SAMPLE' }
  const house = await selectHousePartner(tx)
  if (!house) return { ok: false, code: 'NO_HOUSE_PARTNER' }
  const code = await freeStoreCode(tx, house.id, `demo-${key}`)
  const storeId = await insertDemoStore(tx, {
    partnerId: house.id,
    categoryId: template.category_id,
    name: demoName,
    code,
    slug: await freeStoreSlug(tx, code),
    country: house.country,
    pricingCurrency: template.currency,
    at,
  })
  await insertDemoOwner(tx, house.id, storeId, demoEmail(key), demoName)
  await setTemplateDemo(tx, key, storeId)
  await queueSideEffect(tx, { kind: demoTemplateKind, idempotencyKey: `${demoTemplateKind}:${storeId}`, payload: { storeId, template: key }, partnerId: house.id, storeId })
  return { ok: true, storeId, created: true }
}

export interface DemoFillDeps {
  sql: postgres.Sql
  sites: SitesBucket
  assets: AssetStore
  activity: ActivityLog
  now: () => Date
}

const contextOf = (demo: DemoStoreRow): TenantContext => ({
  caller: { kind: 'person', userId: demo.owner_id, sessionId: '' },
  partnerId: demo.partner_id,
  storeId: demo.store_id,
  sellerScope: { kind: 'all' },
  subscription: 'active',
})

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

const addLogo = async (d: DemoFillDeps, demo: DemoStoreRow): Promise<void> => {
  const bytes = Uint8Array.from(atob(demoLogoPng), (c) => c.charCodeAt(0))
  const key = `stores/${demo.store_id}/assets/${crypto.randomUUID()}.png`
  await d.assets.put(key, bytes, { httpMetadata: { contentType: 'image/png' } })
  const checksum = hex(await crypto.subtle.digest('SHA-256', bytes))
  await withSystemScope(d.sql, async (tx) => {
    const assetId = await insertAsset(tx, { storeId: demo.store_id, sellerId: null, key, kind: 'image', mime: 'image/png', bytes: bytes.length, width: 256, height: 256, checksum, createdBy: null })
    await setDemoLogo(tx, demo.store_id, assetId)
  })
}

// The store's own "Add sample catalog" (apis/store/storeCategory.ts), as its demo Owner: the import checks that seat.
const addSample = async (d: DemoFillDeps, demo: DemoStoreRow): Promise<void> => {
  const context = contextOf(demo)
  const facts = { requestId: `${demoTemplateKind}:${demo.store_id}`, ip: null, userAgent: null }
  const actor = { id: demo.owner_id, label: demoName, partnerId: demo.partner_id }
  const categories = createStoreCategoryService({ sql: d.sql, context, actor, activity: d.activity, facts })
  const sample = await categories.sampleToAdd()
  if (!sample.ok) return
  const imports = createCatalogImportService({
    sql: d.sql,
    context,
    actor,
    activity: d.activity,
    facts,
    now: d.now,
    queue: (tx, kind, key, payload) => queueSideEffect(tx, { kind, idempotencyKey: key, payload, partnerId: demo.partner_id, storeId: demo.store_id }),
  })
  const started = await imports.start(sample.value.file, 'csv', null, sample.value.currency, sample.value.categoryId).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'constraint_name' in error && error.constraint_name === 'catalog_import_one_sample') return null
    throw error
  })
  if (started?.ok) await categories.recordSampleAdded(started.value, sample.value.categoryId)
}

/** The template's ready-built preview copied in whole, then the draft that serves it (PREVIEW §3). */
const copyPreview = async (d: DemoFillDeps, demo: DemoStoreRow, template: string): Promise<void> => {
  const core = await currentCore(d.sites)
  await copyTemplatePreview(d.sites, core, template, previewFolder(demo.store_id, demoPreviewRef))
  await withSystemScope(d.sql, (tx) => upsertDesignDraft(tx, { storeId: demo.store_id, headCommit: noCommit, template, coreVersion: core, previewRef: demoPreviewRef, at: d.now() }))
}

/** The three steps touch different rows and files, so they run side by side; each is skipped once done, so a retry finishes the rest. */
export const fillDemo = async (d: DemoFillDeps, p: DemoParams): Promise<'filled' | 'gone'> => {
  const demo = await withSystemScope(d.sql, (tx) => selectDemoStore(tx, p.storeId))
  if (!demo) return 'gone'
  await Promise.all([demo.has_logo ? null : addLogo(d, demo), addSample(d, demo), demo.preview_ref ? null : copyPreview(d, demo, p.template)])
  return 'filled'
}
