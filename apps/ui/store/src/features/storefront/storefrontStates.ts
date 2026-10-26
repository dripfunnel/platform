import type { StorefrontBrand, StorefrontDomains, StorefrontOverview, StorefrontSeo, StorefrontTemplate } from '../../api/storefront'

// Storefront's states under ?state= (ui/README.md §6): loading, error, denied (Staff), brand (the Owner's first visit),
// gallery (then the templates), creating, list (live, own domain live, framed), oldBuild (live from a build that refuses
// frames), rolledBackLive (the last publish rolled back), draft (unpublished changes), manager and readOnly (past due)
// look only, noSite (a Manager before any publish),
// waiting and failed (an own domain on its way or refused by DNS), free (a plan without an own domain), contentEmpty (no
// pages or posts); the studio's:
// studio (ready), opening, queued, finishing (another tab's change) and ended (the session refused); a publish checking,
// refused (with a change to publish before) or rolled back.
export const studioHarnessStates = ['studio', 'opening', 'queued', 'finishing', 'ended', 'pubChecking', 'pubRefused', 'rolledBack'] as const
export const storefrontStates = ['loading', 'error', 'denied', 'brand', 'gallery', 'creating', 'list', 'oldBuild', 'rolledBackLive', 'draft', 'manager', 'readOnly', 'noSite', 'waiting', 'failed', 'free', 'contentEmpty', ...studioHarnessStates] as const
export type StorefrontState = (typeof storefrontStates)[number]
export const isStudioState = (state: string | null): boolean => studioHarnessStates.some((s) => s === state)

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const savedBrand: StorefrontBrand | null = harness
  ? {
      brandReady: true,
      shopName: 'Kesari Threads',
      logoAssetId: 'sample-logo',
      faviconAssetId: null,
      primaryColour: '#b8541f',
      secondaryColour: '#0a2a4a',
      tagline: 'Handloom from Jaipur',
      description: 'Block-printed clothing and homeware, made by hand in Jaipur and made to last.',
      social: { instagram: 'https://www.instagram.com/kesarithreads', facebook: null, x: null, youtube: null, tiktok: null, whatsapp: 'https://wa.me/919829012345' },
      contactEmail: 'hello@kesarithreads.in',
      contactPhone: '+91 98290 12345',
      contactAddress: { street: '14 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' },
      voice: 'Warm and friendly',
    }
  : null

/** The first visit: Store info's name and contact, nothing of the brand's own yet. */
export const sampleBrand = (state: StorefrontState): StorefrontBrand | null =>
  savedBrand && state === 'brand'
    ? { ...savedBrand, brandReady: false, logoAssetId: null, primaryColour: null, secondaryColour: null, tagline: null, description: null, voice: null, social: { instagram: null, facebook: null, x: null, youtube: null, tiktok: null, whatsapp: null } }
    : savedBrand

export const sampleSeo = (state: StorefrontState): StorefrontSeo =>
  state === 'brand' || !harness
    ? { title: null, description: null, shareImageAssetId: null }
    : { title: 'Kesari Threads — Everyday clothes and homeware, made to last', description: 'Everyday clothes and homeware, made to last. Free returns within 30 days.', shareImageAssetId: 'sample-photo-1' }

const free = { id: null, host: 'kesari-threads.shops.dripfunnel.ai', kind: 'free' as const, checkedAt: null, records: [] }
const own = { id: 'sample-own', host: 'www.kesarithreads.in', kind: 'custom' as const }
const records = (found: string | null) => [
  { type: 'CNAME', name: 'www.kesarithreads.in', value: 'shops.edge.dripfunnel.ai', found },
  { type: 'TXT', name: '_df-verify.www.kesarithreads.in', value: 'df-verify=3f9c2a71', found: null },
]

export const sampleDomains = (state: StorefrontState): StorefrontDomains => {
  if (!harness || state === 'brand' || state === 'free') return { customDomainAllowed: state !== 'free', domains: harness ? [{ ...free, status: 'live', primary: true }] : [] }
  const checkedAt = '2026-10-12T08:40:00Z'
  if (state === 'waiting') return { customDomainAllowed: true, domains: [{ ...free, status: 'live', primary: true }, { ...own, status: 'waiting', primary: false, checkedAt, records: records(null) }] }
  if (state === 'failed') return { customDomainAllowed: true, domains: [{ ...free, status: 'live', primary: true }, { ...own, status: 'failed', primary: false, checkedAt, records: records('kesarithreads.wixdns.net') }] }
  return { customDomainAllowed: true, domains: [{ ...free, status: 'live', primary: false }, { ...own, status: 'live', primary: true, checkedAt, records: records('shops.edge.dripfunnel.ai') }] }
}

const templateRows: readonly (readonly [string, string, string, string])[] = harness
  ? [
      ['baseline', 'Start from scratch', 'Blank', 'A plain header, banner, story and footer. Describe your shop and the AI styles it.'],
      ['linen', 'Linen', 'Minimal fashion', 'Light, roomy and quiet. Big photos, small type, nothing in the way.'],
      ['concrete', 'Concrete', 'Bold streetwear', 'Loud type, hard edges and a bright accent.'],
      ['bloom', 'Bloom', 'Beauty & wellness', 'Soft colour, rounded shapes and calm serif headings.'],
      ['circuit', 'Circuit', 'Electronics & tech', 'Dark, sharp and spec-led. Clear details and help up front.'],
      ['market', 'Market', 'Food & grocery', 'Warm, friendly and easy to browse.'],
      ['atelier', 'Atelier', 'Luxury editorial', 'Magazine-like pacing. Large serif type, muted tones, lots of space.'],
    ]
  : []

const unstarted = (state: StorefrontState) => state === 'brand' || state === 'gallery' || state === 'noSite'

export const sampleTemplates = (state: StorefrontState): StorefrontTemplate[] =>
  templateRows.map(([key, name, tag, description]) => ({ key, name, tag, description, demoUrl: key === 'baseline' ? null : `https://${key}-demo.shops.dripfunnel.ai`, current: !unstarted(state) && state !== 'creating' && key === 'linen' }))

export const sampleOverview = (state: StorefrontState): StorefrontOverview => {
  if (!harness || unstarted(state)) return { status: 'not_started', template: null, live: null, draft: null, lastPublish: null }
  if (state === 'creating') return { status: 'creating', template: 'linen', live: null, draft: null, lastPublish: null }
  const live = { number: 12, publishedAt: '2026-10-09T10:40:00Z', template: 'linen', portalOrigin: state === 'oldBuild' ? null : window.location.origin }
  const draft = { template: 'linen', changedAt: '2026-10-12T08:15:00Z', previewReady: true }
  const lastPublish =
    state === 'rolledBackLive' ? { state: 'rolled_back' as const, error: 'check_checkout', version: null, finishedAt: '2026-10-12T09:05:00Z' } : { state: 'live' as const, error: null, version: 12, finishedAt: live.publishedAt }
  return state === 'draft' || state === 'manager' || isStudioState(state) ? { status: 'unpublished_changes', template: 'linen', live, draft, lastPublish } : { status: 'same_as_live', template: 'linen', live, draft: null, lastPublish }
}
