import type postgres from 'postgres'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { markDispatched, selectAssetsBuild, selectBuildInput, selectSnapshotSource, unmarkDispatched } from '#db/scoped/publishing'
import { GitHubRefused, GitHubUnavailable } from '#integrations/github/index'
import { selectShopStore } from '#db/scoped/shop'
import { selectGuardContext, type GuardContextRow } from '#db/scoped/studio'
import type { GuardContext } from '#integrations/sandbox/index'
import { storeContentPaths } from '#engine/modules/content/index'
import { shopsHostOf } from '#saas/domains/storeHosts'
import { socialNetworks } from '#saas/storefrontSettings/index'
import { assetsFolder, draftBundle, snapshotFile, sourceBundle, upgradeBundle } from './layout'
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
export const guardContextFor = (row: GuardContextRow, usedPaths: string[]): GuardContext => ({
  locales: [...new Set([row.main_language, ...row.languages].map((l) => l.split('-')[0] ?? l))],
  usedPaths,
  mediaIds: row.media_ids,
  brand: { name: row.name, tagline: null, email: null, phone: null, address: [], socialLinks: [] },
})

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (bytes: ArrayBuffer) => hex(await crypto.subtle.digest('SHA-256', bytes))

/** core's `catalogueSnapshotSchema` (storefront ARCHITECTURE §4.2, `./guard`): the store as the Shop API answers it. */
const snapshotOf = async (tx: ScopedSql, storeId: string, assetsBuildId: string, assetOrigin: string | null): Promise<unknown> => {
  const store = await selectShopStore(tx, storeId)
  const source = await selectSnapshotSource(tx, storeId)
  const guard = await selectGuardContext(tx, storeId)
  if (!store || !source || !guard) throw new FreezeRefused('no_source')
  if (!source.shops_host) throw new FreezeRefused('no_address')
  const languages = store.languages.length > 0 ? store.languages : [store.main_language]
  return {
    version: 1,
    // The primary address, which canonical links and the sitemap name (SAAS §8): the store's own domain once made so.
    origin: `https://${source.primary_host ?? shopsHostOf(source.shops_host, source.code)}`,
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
      favicon: store.favicon_asset_id ? { url: `/shop-api/assets/${store.favicon_asset_id}` } : null,
      tagline: store.tagline,
      social: socialNetworks.flatMap((network) => (store.social[network] ? [{ network, url: store.social[network] }] : [])),
      seo: store.seo && { title: store.seo.title, description: store.seo.description, image: store.seo.share_asset_id ? { url: `/shop-api/assets/${store.seo.share_asset_id}` } : null },
    },
    poweredBy: source.powered_by,
    guard: guardContextFor(guard, await storeContentPaths(tx, storeId)),
    csp: { assetOrigin, mediaOrigins: [], analytics: [], payments: [] },
    assetBase: assetOrigin ? `${assetOrigin}/${assetsFolder(storeId, assetsBuildId)}` : null,
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
    // A page run's pages load the live build's JS and CSS, which the same commit builds byte for byte (LIVE-SHOP §7).
    const assetsBuild = found.kind === 'page' && found.live_build_id ? ((await selectAssetsBuild(tx, found.live_build_id)) ?? found.live_build_id) : buildId
    return { input: found, snapshot: found.reported ? null : await snapshotOf(tx, storeId, assetsBuild, deps.assetOrigin) }
  })
  if (input.reported || snapshot === null) return 'reported'
  // An upgrade or a security fix builds the upgrade bot's private commit (LIVE-SHOP §8), never the live one.
  const upgrade = input.kind === 'upgrade' || input.kind === 'security'
  const from = input.kind === 'design' ? draftBundle(storeId) : upgrade ? upgradeBundle(storeId, input.commit) : input.live_build_id ? sourceBundle(storeId, input.live_build_id) : null
  const source = from ? await deps.drafts.get(from) : null
  if (!source) throw new FreezeRefused('no_source')
  const bundle = await source.arrayBuffer()
  await deps.drafts.put(sourceBundle(storeId, buildId), bundle, { sha256: await sha256(bundle), httpMetadata: { contentType: 'application/x-git-bundle' } })
  const json = new TextEncoder().encode(JSON.stringify(snapshot)).buffer
  await deps.drafts.put(snapshotFile(storeId, buildId), json, { sha256: await sha256(json), httpMetadata: { contentType: 'application/json' } })
  return 'frozen'
}

/**
 * Step 4: the store repo's locked workflow, started at most once with the build id and the hooks host. The start is
 * recorded before GitHub is asked, and taken back only when GitHub said no, so a retried step never starts a second run.
 */
export const dispatchBuild = async (deps: FreezeDeps, storeId: string, buildId: string): Promise<'dispatched' | 'skipped'> => {
  const input = await withSystemScope(deps.sql, (tx) => selectBuildInput(tx, storeId, buildId))
  if (input?.dispatched_at || input?.reported) return 'skipped'
  if (!input?.repo) throw new FreezeRefused('no_repo')
  const repo = input.repo
  if (!(await withSystemScope(deps.sql, (tx) => markDispatched(tx, storeId, buildId, deps.now())))) return 'skipped'
  let started: boolean
  try {
    started = await deps.dispatch(repo, buildId)
  } catch (error) {
    // Only a definite refusal (a 4xx, or a 401 or 429 GitHub never acted on) means no run started, so the retry may ask
    // again; a 5xx or no answer at all may hide a started run, so the start stands and the report, or the 2 hours, decides.
    const refused = error instanceof GitHubRefused || (error instanceof GitHubUnavailable && (error.status === 401 || error.status === 429))
    if (refused) await withSystemScope(deps.sql, (tx) => unmarkDispatched(tx, storeId, buildId))
    throw error
  }
  if (!started) {
    // GitHub answered that the repo doesn't exist: no run started, and the publish fails as such, not by waiting.
    await withSystemScope(deps.sql, (tx) => unmarkDispatched(tx, storeId, buildId))
    throw new FreezeRefused('no_repo')
  }
  return 'dispatched'
}
