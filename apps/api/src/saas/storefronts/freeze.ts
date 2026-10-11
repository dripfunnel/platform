import type postgres from 'postgres'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { markDispatched, selectBuildInput, selectSnapshotSource } from '#db/scoped/publishing'
import { selectShopStore } from '#db/scoped/shop'
import { selectGuardContext, type GuardContextRow } from '#db/scoped/studio'
import type { GuardContext } from '#integrations/sandbox/index'
import { shopsHostOf } from '#saas/domains/storeHosts'
import { assetsFolder, draftBundle, snapshotFile, sourceBundle } from './layout'
import type { SitesBucket } from './templates'

// The frozen input of storefront LIVE-SHOP §4 steps 2–4: the source as a git bundle and the catalogue snapshot, kept
// privately with the build, then the store repo's locked workflow started with the build id.

/** Why a build can't start; the publish fails with this code (SAAS §9.1). */
export type FreezeRefusal = 'no_source' | 'no_address' | 'no_repo'

export class FreezeRefused extends Error {
  override name = 'FreezeRefused'
  constructor(readonly code: FreezeRefusal) {
    super(code)
  }
}

export const freezeRefusals: ReadonlySet<string> = new Set<FreezeRefusal>(['no_source', 'no_address', 'no_repo'])

export interface FreezeDeps {
  sql: postgres.Sql
  drafts: SitesBucket
  /** The public asset host (LIVE-SHOP §2 `storefront-assets`), whose build folder the pages load their JS and CSS from. */
  assetOrigin: string | null
  /** Starts the locked workflow (integrations/github `dispatchBuild`); false when GitHub has no such repo. */
  dispatch: (repo: string, buildId: string) => Promise<boolean>
  now: () => Date
}

/** A theme writes one content folder per language (`content/en`), which core's i18n reads for en-US and en-IN alike. */
export const guardContextFor = (row: GuardContextRow): GuardContext => ({
  locales: [...new Set([row.main_language, ...row.languages].map((l) => l.split('-')[0] ?? l))],
  // Content pages and posts (SAPI 24) don't exist yet, so no path is taken but core's (ARCHITECTURE §3.1).
  usedPaths: [],
  mediaIds: row.media_ids,
  brand: { name: row.name, tagline: null, email: null, phone: null, address: [], socialLinks: [] },
})

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (bytes: ArrayBuffer) => hex(await crypto.subtle.digest('SHA-256', bytes))

/** core's `catalogueSnapshotSchema` (storefront ARCHITECTURE §4.2, `./guard`): the store as the Shop API answers it. */
const snapshotOf = async (tx: ScopedSql, storeId: string, buildId: string, assetOrigin: string | null): Promise<unknown> => {
  const store = await selectShopStore(tx, storeId)
  const source = await selectSnapshotSource(tx, storeId)
  const guard = await selectGuardContext(tx, storeId)
  if (!store || !source || !guard) throw new FreezeRefused('no_source')
  if (!source.shops_host) throw new FreezeRefused('no_address')
  const languages = store.languages.length > 0 ? store.languages : [store.main_language]
  return {
    version: 1,
    origin: `https://${shopsHostOf(source.shops_host, source.code)}`,
    store: {
      name: store.name,
      description: store.description,
      language: store.main_language,
      mainLanguage: store.main_language,
      languages,
      currency: store.pricing_currency,
      pricingCurrency: store.pricing_currency,
      currencies: store.currencies.map((c) => ({ code: c.currency })),
      pricesIncludeTax: store.tax_inclusive,
      timeZone: store.time_zone ?? 'UTC',
      contactEmail: store.contact_email,
      contactPhone: store.contact_phone,
      logo: store.logo_asset_id ? { url: `/shop-api/assets/${store.logo_asset_id}` } : null,
      address: { street: store.address.street ?? null, city: store.address.city ?? null, region: store.address.region ?? null, postal: store.address.postal ?? null, country: store.country },
    },
    poweredBy: source.powered_by,
    guard: guardContextFor(guard),
    csp: { assetOrigin, mediaOrigins: [], analytics: [], payments: [] },
    assetBase: assetOrigin ? `${assetOrigin}/${assetsFolder(storeId, buildId)}` : null,
  }
}

/**
 * Step 3: the source (the draft for a design publish, else the live build's own source bundle, never GitHub) and the
 * snapshot, each under the build's id. Idempotent, and skipped once the build reported.
 */
export const freezeBuild = async (deps: FreezeDeps, storeId: string, buildId: string): Promise<'frozen' | 'reported'> => {
  const { input, snapshot } = await withSystemScope(deps.sql, async (tx) => {
    const found = await selectBuildInput(tx, storeId, buildId)
    if (!found) throw new FreezeRefused('no_source')
    return { input: found, snapshot: found.reported ? null : await snapshotOf(tx, storeId, buildId, deps.assetOrigin) }
  })
  if (input.reported || snapshot === null) return 'reported'
  const from = input.kind === 'design' ? draftBundle(storeId) : input.live_build_id ? sourceBundle(storeId, input.live_build_id) : null
  const source = from ? await deps.drafts.get(from) : null
  if (!source) throw new FreezeRefused('no_source')
  const bundle = await source.arrayBuffer()
  await deps.drafts.put(sourceBundle(storeId, buildId), bundle, { sha256: await sha256(bundle), httpMetadata: { contentType: 'application/x-git-bundle' } })
  const json = new TextEncoder().encode(JSON.stringify(snapshot)).buffer
  await deps.drafts.put(snapshotFile(storeId, buildId), json, { sha256: await sha256(json), httpMetadata: { contentType: 'application/json' } })
  return 'frozen'
}

/** Step 4: the store repo's locked workflow, started once with the build id and the hooks host. */
export const dispatchBuild = async (deps: FreezeDeps, storeId: string, buildId: string): Promise<'dispatched' | 'skipped'> => {
  const input = await withSystemScope(deps.sql, (tx) => selectBuildInput(tx, storeId, buildId))
  if (input?.dispatched_at || input?.reported) return 'skipped'
  if (!input?.repo) throw new FreezeRefused('no_repo')
  if (!(await deps.dispatch(input.repo, buildId))) throw new FreezeRefused('no_repo')
  await withSystemScope(deps.sql, (tx) => markDispatched(tx, storeId, buildId, deps.now()))
  return 'dispatched'
}
