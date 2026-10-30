import { deleteContent, loadContentEntry, loadContentList, loadContentTranslation, loadCustomPaths, saveContent, saveContentTranslation } from '../../api/content'
import { loadProductNames } from '../../api/offers'
import { uploadPhoto } from '../../api/productEditor'
import { checkDomain, chooseTemplate, connectDomain, discardDraft, endPreviewLinks, goBackToVersion, loadBrand, loadDomains, loadHistory, loadMeters, loadOverview, loadPoweredBy, loadSeo, loadShareImages, loadTemplates, makeDomainPrimary, previewLink, publishNow, removeDomain, saveBrand, saveSeo } from '../../api/storefront'
import { ApiError } from '@dripfunnel/shared/graphql'
import type { StorefrontDomains, StorefrontMeters, StorefrontVersion } from '../../api/storefront'
import { postAsset } from '../../api/productEditor'
import { deleteLibraryAsset, loadLibrary, renameLibraryAsset } from '../../api/assetLibrary'
import { askDesign, cancelDesign, importDesignImage, loadStockAvailable, searchStockImages, useStockImage, loadDesignChat, loadDesignText, loadPublishRun, loadStudioLanguages, loadStudioPages, loadStudioSession, publishBefore, publishDesign, renewStudioSession, saveDesignText, undoDesignChange } from '../../api/studio'
import type { DesignMessage, PublishRun } from '../../api/studio'
import { sampleContent } from './contentSample'
import { sampleBrand, sampleDomains, sampleOverview, sampleSeo, sampleTemplates, type StorefrontState } from './storefrontStates'

/** What Storefront reads and writes: the Store API, or the harness's sample kept in memory (ui/README.md §6). */
export interface StorefrontApi {
  loadBrand: typeof loadBrand
  saveBrand: typeof saveBrand
  loadSeo: typeof loadSeo
  saveSeo: typeof saveSeo
  loadDomains: typeof loadDomains
  connectDomain: typeof connectDomain
  checkDomain: typeof checkDomain
  makeDomainPrimary: typeof makeDomainPrimary
  removeDomain: typeof removeDomain
  loadShareImages: typeof loadShareImages
  uploadImage: typeof uploadPhoto
  loadOverview: typeof loadOverview
  loadTemplates: typeof loadTemplates
  chooseTemplate: typeof chooseTemplate
  discardDraft: typeof discardDraft
  loadPoweredBy: typeof loadPoweredBy
  loadStudioSession: typeof loadStudioSession
  renewStudioSession: typeof renewStudioSession
  loadDesignChat: typeof loadDesignChat
  askDesign: typeof askDesign
  loadLibrary: typeof loadLibrary
  uploadAsset: typeof postAsset
  renameLibraryAsset: typeof renameLibraryAsset
  deleteLibraryAsset: typeof deleteLibraryAsset
  cancelDesign: typeof cancelDesign
  loadStockAvailable: typeof loadStockAvailable
  searchStockImages: typeof searchStockImages
  useStockImage: typeof useStockImage
  importDesignImage: typeof importDesignImage
  undoDesignChange: typeof undoDesignChange
  loadDesignText: typeof loadDesignText
  saveDesignText: typeof saveDesignText
  loadStudioPages: typeof loadStudioPages
  loadStudioLanguages: typeof loadStudioLanguages
  publishDesign: typeof publishDesign
  publishBefore: typeof publishBefore
  loadPublishRun: typeof loadPublishRun
  loadMeters: typeof loadMeters
  publishNow: typeof publishNow
  loadHistory: typeof loadHistory
  goBackToVersion: typeof goBackToVersion
  previewLink: typeof previewLink
  endPreviewLinks: typeof endPreviewLinks
  loadContentList: typeof loadContentList
  loadCustomPaths: typeof loadCustomPaths
  loadContentEntry: typeof loadContentEntry
  saveContent: typeof saveContent
  deleteContent: typeof deleteContent
  loadProductNames: typeof loadProductNames
  loadContentTranslation: typeof loadContentTranslation
  saveContentTranslation: typeof saveContentTranslation
}

export const storeApi: StorefrontApi = { loadBrand, saveBrand, loadSeo, saveSeo, loadDomains, connectDomain, checkDomain, makeDomainPrimary, removeDomain, loadShareImages, uploadImage: uploadPhoto, loadOverview, loadTemplates, chooseTemplate, discardDraft, loadPoweredBy, loadStudioSession, renewStudioSession, loadDesignChat, askDesign, loadLibrary, uploadAsset: postAsset, renameLibraryAsset, deleteLibraryAsset, cancelDesign, importDesignImage, loadStockAvailable, searchStockImages, useStockImage, undoDesignChange, loadDesignText, saveDesignText, loadStudioPages, loadStudioLanguages, publishDesign, publishBefore, loadPublishRun, loadMeters, publishNow, loadHistory, goBackToVersion, previewLink, endPreviewLinks, loadContentList, loadCustomPaths, loadContentEntry, saveContent, deleteContent, loadProductNames, loadContentTranslation, saveContentTranslation }

/** The harness's store: writes change the sample in memory, so a click-through behaves without a backend. */
export const sampleApi = (state: StorefrontState): StorefrontApi => {
  let brand = sampleBrand(state)
  let seo = sampleSeo(state)
  let domains: StorefrontDomains = sampleDomains(state)
  let uploads = 0
  let overview = sampleOverview(state)
  let templates = sampleTemplates(state)
  const domain = (id: string) => domains.domains.find((d) => d.id === id)
  return {
    loadBrand: () => Promise.resolve(brand),
    saveBrand: (input) => {
      brand = { ...input, brandReady: true }
      return Promise.resolve(brand)
    },
    loadSeo: () => Promise.resolve(seo),
    saveSeo: (input) => {
      seo = input
      return Promise.resolve(seo)
    },
    loadDomains: () => Promise.resolve(domains),
    connectDomain: (host) => {
      const added = { id: `sample-${host}`, host, kind: 'custom' as const, status: 'waiting' as const, primary: false, checkedAt: null, records: [{ type: 'CNAME', name: host, value: 'shops.edge.dripfunnel.ai', found: null }, { type: 'TXT', name: `_df-verify.${host}`, value: 'df-verify=sample', found: null }] }
      domains = { ...domains, domains: [...domains.domains, added] }
      return Promise.resolve(added)
    },
    checkDomain: (id) => {
      domains = { ...domains, domains: domains.domains.map((d) => (d.id === id ? { ...d, checkedAt: new Date().toISOString() } : d)) }
      return Promise.resolve()
    },
    makeDomainPrimary: (id) => {
      domains = { ...domains, domains: domains.domains.map((d) => ({ ...d, primary: d.id === id })) }
      return Promise.resolve()
    },
    removeDomain: (id) => {
      const gone = domain(id)
      domains = { ...domains, domains: domains.domains.filter((d) => d.id !== id).map((d) => (gone?.primary && d.kind === 'free' ? { ...d, primary: true } : d)) }
      return Promise.resolve()
    },
    loadShareImages: () => Promise.resolve(state === 'list' ? ['sample-photo-1', 'sample-photo-2', 'sample-photo-3'] : []),
    uploadImage: () => {
      uploads += 1
      return Promise.resolve({ ok: true, assetId: `sample-upload-${uploads}` })
    },
    loadOverview: () => Promise.resolve(overview),
    loadTemplates: () => Promise.resolve(templates),
    // The first choice reads back as made at once: the harness has no Workflow to wait for.
    chooseTemplate: (key) => {
      const first = overview.status === 'not_started' || overview.status === 'create_failed'
      const draft = { template: key, changedAt: new Date().toISOString(), previewReady: true }
      overview = { ...overview, status: first ? 'not_published' : 'unpublished_changes', template: key, draft }
      templates = templates.map((t) => ({ ...t, current: t.key === key }))
      return Promise.resolve(first ? 'creating' : 'unpublished_changes')
    },
    discardDraft: () => {
      overview = { ...overview, status: 'same_as_live', template: overview.live?.template ?? null, draft: null }
      templates = templates.map((t) => ({ ...t, current: t.key === overview.template }))
      return Promise.resolve()
    },
    loadPoweredBy: () => Promise.resolve({ removed: false, removable: true }),
    ...sampleStudio(state),
    ...sampleMeters(state),
    ...sampleContent(state),
  }
}

const sampleSession = { session: 'sampleStudioSession0000', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], frameUrl: 'https://kesari-threads.webpreview.store/__studio/sampleStudioSession0000/', access: 'change' as const, expiresAt: '2026-10-12T09:05:00Z' }
const sessionStates: Partial<Record<StorefrontState, { state: 'starting' | 'queued' | 'busy'; place: number | null }>> = { opening: { state: 'starting', place: null }, queued: { state: 'queued', place: 1 }, finishing: { state: 'busy', place: null } }

/** The studio's sample: a short conversation, and every change accepted at once. */
const sampleStudio = (state: StorefrontState) => {
  const at = '2026-10-12T08:15:00Z'
  const line = (id: string, role: DesignMessage['role'], text: string, more: Partial<DesignMessage> = {}): DesignMessage => ({ id, role, text, changed: [], imageAssetId: null, sampleUrl: null, canUndo: false, undone: false, createdAt: at, ...more })
  let chat: DesignMessage[] = [
    line('m3', 'ai', 'I warmed up the background and buttons and gave the home page an autumn headline.', { changed: ['Colours', 'Hero headline'], canUndo: true }),
    line('m2', 'user', 'Make the colours warmer and give the home page an autumn headline'),
    line('m1', 'note', 'template:linen'),
  ]
  let n = 3
  return {
    loadStudioSession: () => (state === 'ended' ? Promise.reject(new ApiError('SESSION_ENDED', 'Ended.')) : Promise.resolve({ ...sampleSession, ...(sessionStates[state] ?? { state: 'ready' as const, place: null }) })),
    renewStudioSession: () => Promise.resolve(),
    loadDesignChat: () => Promise.resolve({ messages: chat, next: null }),
    askDesign: (input: { text: string; imageAssetId: string | null; sampleUrl: string | null }) => {
      n += 2
      chat = [line(`m${n}`, 'ai', 'Done — the preview shows it now.', { changed: ['Layout'], canUndo: true }), line(`m${n - 1}`, 'user', input.text, { imageAssetId: input.imageAssetId, sampleUrl: input.sampleUrl }), ...chat.map((m) => ({ ...m, canUndo: false }))]
      return Promise.resolve('changed')
    },
    importDesignImage: () => Promise.resolve('sample-import-1'),
    cancelDesign: () => Promise.resolve(true),
    loadLibrary: () => Promise.resolve({ assets: ['Hero photo', 'Linen close-up', 'Studio', 'Banner'].map((name, i) => ({ id: `sample-asset-${i}`, kind: 'image' as const, mime: 'image/png', bytes: 180_000 + i * 37_000, width: 1200, height: 900, name, uses: i % 3 === 0 ? 1 : 0, createdAt: '2026-10-29T10:00:00Z' })), next: null }),
    uploadAsset: () => Promise.resolve({ ok: true as const, asset: { id: 'sample-upload', kind: 'image', mime: 'image/png', bytes: 1000 } }),
    renameLibraryAsset: () => Promise.resolve(),
    deleteLibraryAsset: () => Promise.resolve(),
    loadStockAvailable: () => Promise.resolve(true),
    searchStockImages: () => Promise.resolve([1, 2, 3, 4, 5, 6].map((n) => ({ id: String(n), thumb: '', user: 'A contributor', pageUrl: 'https://pixabay.com/', tags: 'sample' }))),
    useStockImage: () => Promise.resolve('sample-stock-1'),
    undoDesignChange: (id: string) => {
      chat = [line(`m${(n += 1)}`, 'note', 'undone'), ...chat.map((m) => (m.id === id ? { ...m, undone: true, canUndo: false } : m))]
      return Promise.resolve()
    },
    loadDesignText: (_page: string, locale: string) => Promise.resolve([{ key: 'pages:home.lead', text: locale === 'en' ? 'Warm layers for cooler days' : '' }]),
    saveDesignText: () => Promise.resolve(),
    loadStudioPages: () => Promise.resolve({ product: { name: 'Indigo block-print kurta', slug: 'indigo-block-print-kurta' }, content: [{ title: 'Questions we get asked', path: '/faq' }], custom: ['/about', '/contact'] }),
    loadStudioLanguages: () => Promise.resolve(['en', 'hi']),
    publishDesign: () => Promise.resolve('sample-run'),
    publishBefore: () => Promise.resolve('sample-run'),
    loadPublishRun: (id: string) => Promise.resolve(samplePublish(state, id)),
  }
}

/** pubChecking stays on its checks; pubRefused names a change to publish before; rolledBack went live and was put back. */
const samplePublish = (state: StorefrontState, id: string): PublishRun => {
  const failed = { name: 'price-visible', passed: false, words: 'On phones, the new buy bar covers the price and its tax label, so shoppers can’t see what they’d pay.' }
  if (state === 'pubRefused') return { id, step: 'failed', version: 13, repairAttempts: 3, checks: [failed], bisectMessageId: 'm2' }
  if (state === 'rolledBack') return { id, step: 'rolled_back', version: 13, repairAttempts: 0, checks: [{ ...failed, words: 'Your new version broke the checkout on phones.' }], bisectMessageId: null }
  return { id, step: state === 'pubChecking' ? 'checking' : 'live', version: 13, repairAttempts: 0, checks: [], bisectMessageId: null }
}

/** `waiting` has catalogue changes for the Publish now bar; `list` has none; every state has a short history. */
const sampleMeters = (state: StorefrontState) => {
  let live = 12
  const versions = (): StorefrontVersion[] =>
    [12, 11, 10].map((number) => ({ id: `v${number}`, number, template: 'linen', label: number === 12 ? 'Autumn colours and headline' : number === 11 ? 'Add a reviews section' : null, live: number === live, publishedAt: `2026-10-0${number - 3}T10:40:00Z` }))
  return {
    loadMeters: (): Promise<StorefrontMeters> =>
      Promise.resolve({
        catalogue: { waiting: state === 'draft' || state === 'manager', since: '2026-10-12T08:40:00Z', changedKinds: ['products'], changedProducts: 12, pressesAllowed: 10, pressesLeft: 7, nextAutomaticPublishAt: '2026-10-12T14:40:00Z' },
        usage: { ownKey: false, aiRequests: 42, aiPromptsUsed: 42, aiPromptsAllowed: 1000, buildMinutes: 18, publishesLast30Days: 3, recent: [{ id: 'r1', text: 'Make the colours warmer and give the home page an autumn headline', createdAt: '2026-10-12T08:15:00Z' }] },
      }),
    publishNow: () => Promise.resolve('sample-run'),
    loadHistory: (before: number | null) => Promise.resolve(before === null ? versions() : []),
    goBackToVersion: (number: number) => {
      live = number
      return Promise.resolve()
    },
    previewLink: () => Promise.resolve('https://kesari-threads.webpreview.store/?preview=sample'),
    endPreviewLinks: () => Promise.resolve(),
  }
}
