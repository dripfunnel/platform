import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { TenantContext } from '#core/tenancy'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { isMerchantImage, isProductPhoto, queuePageRender, saveStoreName, selectBrand, selectHomePaths, selectSeo, upsertBrand, upsertSeo, type BrandRow, type SeoRow } from '#db/scoped/storefrontSettings'
import { cleanBrand, cleanSeo, SettingsInvalid, type SettingsRefusal } from './rules'

export type { SeoRow } from '#db/scoped/storefrontSettings'
export { createStoreDomainsService, domainAudit, type DomainRefusal, type DomainResult, type DomainsView, type DomainView } from './domains'
export { maxSeoDescription, maxSeoTitle, socialNetworks, type SettingsRefusal, type SocialNetwork } from './rules'

// Storefront › Site settings and the "Your brand" step (FIRST-RELEASE §14; SAAS §9.2): the Owner writes (`publish`), the
// Manager reads (`storefront.read`). Brand and search words reach a theme only through core's useStorefront().

export const storefrontSettingsAudit = { brandChanged: 'storefront.brand_changed', seoChanged: 'storefront.seo_changed' } as const

export type SettingsResult<T> = { ok: true; value: T } | ({ ok: false } & (SettingsRefusal | { reason: 'NOT_FOUND' }))

export type BrandView = BrandRow & { ready: boolean }

export interface StorefrontSettingsDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

class NotFound extends Error {}

/** The names of the fields whose values differ, never the values (LOGGING §3). */
const changedNames = (before: Record<string, unknown>, after: Record<string, unknown>): string | null => {
  const names = Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
  return names.length > 0 ? names.join(', ') : null
}

export const createStorefrontSettingsService = ({ sql, context, actor, activity, facts, now }: StorefrontSettingsDeps) => {
  const { storeId } = context

  const entry = (action: string, label: string, reason: string | null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId: null,
    target: { type: 'storefront', id: storeId, label },
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<SettingsResult<T>> => {
    try {
      return { ok: true, value: await withScope(sql, context, work) }
    } catch (error) {
      if (error instanceof SettingsInvalid) return { ok: false, ...error.refusal }
      if (error instanceof NotFound) return { ok: false, reason: 'NOT_FOUND' }
      throw error
    }
  }

  const viewOf = (row: BrandRow): BrandView => ({ ...row, ready: row.shop_name.trim() !== '' && row.saved })

  const brandIn = async (tx: ScopedSql): Promise<BrandView> => {
    const row = await selectBrand(tx, storeId)
    if (!row) throw new NotFound()
    return viewOf(row)
  }

  const brand = () =>
    withScope(sql, context, async (tx) => {
      const row = await selectBrand(tx, storeId)
      return row ? viewOf(row) : null
    })

  /** The whole section at once, as Store info saves; the shop name is Store info's, changed only when given. */
  const saveBrand = (raw: unknown): Promise<SettingsResult<BrandView>> =>
    run(async (tx) => {
      const clean = cleanBrand(raw)
      const before = await brandIn(tx)
      for (const [field, id] of [['logo', clean.logoAssetId], ['favicon', clean.faviconAssetId]] as const) {
        if (id && !(await isMerchantImage(tx, storeId, id))) throw new SettingsInvalid({ reason: 'INVALID_IMAGE', field })
      }
      const { shopName, ...write } = clean
      if (shopName !== null && shopName !== before.shop_name) await saveStoreName(tx, shopName)
      await upsertBrand(tx, storeId, write, now())
      const after = await brandIn(tx)
      const fields = (b: BrandRow) => ({
        shop_name: b.shop_name,
        logo: b.logo_asset_id,
        favicon: b.favicon_asset_id,
        primary_colour: b.primary_colour,
        secondary_colour: b.secondary_colour,
        tagline: b.tagline,
        description: b.description,
        social: b.social,
        contact_email: b.contact_email,
        contact_phone: b.contact_phone,
        contact_address: b.contact_address,
        voice: b.voice,
      })
      await activity.record(tx, entry(storefrontSettingsAudit.brandChanged, 'Brand', changedNames(fields(before), fields(after))))
      return after
    })

  const seo = () => withScope(sql, context, (tx) => selectSeo(tx, storeId))

  /** Re-renders the home page at once with a single-page render, using no allowance (SAAS §9.2; FIRST-RELEASE §14). */
  const saveSeo = (raw: unknown): Promise<SettingsResult<SeoRow>> =>
    run(async (tx) => {
      const clean = cleanSeo(raw)
      if (clean.shareAssetId && !(await isProductPhoto(tx, storeId, clean.shareAssetId))) throw new SettingsInvalid({ reason: 'INVALID_IMAGE', field: 'shareImage' })
      const before = await selectSeo(tx, storeId)
      await upsertSeo(tx, storeId, clean, now())
      const after = await selectSeo(tx, storeId)
      const changed = changedNames({ title: before.title, description: before.description, share_image: before.share_asset_id }, { title: after.title, description: after.description, share_image: after.share_asset_id })
      if (changed) await queuePageRender(tx, storeId, await selectHomePaths(tx, storeId))
      await activity.record(tx, entry(storefrontSettingsAudit.seoChanged, 'Search and sharing', changed))
      return after
    })

  return { brand, saveBrand, seo, saveSeo }
}
