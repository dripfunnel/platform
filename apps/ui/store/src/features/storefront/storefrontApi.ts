import { deleteContent, loadContentEntry, loadContentList, loadContentTranslation, saveContent, saveContentTranslation } from '../../api/content'
import { loadProductNames } from '../../api/offers'
import { uploadPhoto } from '../../api/productEditor'
import { checkDomain, chooseTemplate, connectDomain, discardDraft, endPreviewLinks, goBackToVersion, loadBrand, loadDomains, loadHistory, loadMeters, loadOverview, loadPoweredBy, loadSeo, loadShareImages, loadTemplates, makeDomainPrimary, previewLink, publishNow, removeDomain, saveBrand, saveSeo } from '../../api/storefront'
import { ApiError } from '@dripfunnel/shared/graphql'
import type { StorefrontDomains, StorefrontMeters, StorefrontVersion } from '../../api/storefront'
import { postAsset } from '../../api/productEditor'
import { deleteLibraryAsset, loadLibrary, renameLibraryAsset } from '../../api/assetLibrary'
import { answerDesignQuestions, askDesign, buildDesignPlan, cancelDesign, changeDesignPlan, importDesignImage, openStudioLive, loadStockAvailable, searchStockImages, useStockImage, loadDesignChat, loadDesignText, loadPublishRun, loadStudioLanguages, loadStudioPages, loadStudioSession, publishBefore, publishDesign, renewStudioSession, saveDesignText, studioActivity, undoDesignChange } from '../../api/studio'
import type { DesignMessage, LiveEvent, PublishRun } from '../../api/studio'
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
  studioActivity: typeof studioActivity
  openStudioLive: typeof openStudioLive
  loadDesignChat: typeof loadDesignChat
  askDesign: typeof askDesign
  answerDesignQuestions: typeof answerDesignQuestions
  changeDesignPlan: typeof changeDesignPlan
  buildDesignPlan: typeof buildDesignPlan
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
  loadContentEntry: typeof loadContentEntry
  saveContent: typeof saveContent
  deleteContent: typeof deleteContent
  loadProductNames: typeof loadProductNames
  loadContentTranslation: typeof loadContentTranslation
  saveContentTranslation: typeof saveContentTranslation
}

export const storeApi: StorefrontApi = { loadBrand, saveBrand, loadSeo, saveSeo, loadDomains, connectDomain, checkDomain, makeDomainPrimary, removeDomain, loadShareImages, uploadImage: uploadPhoto, loadOverview, loadTemplates, chooseTemplate, discardDraft, loadPoweredBy, loadStudioSession, renewStudioSession, studioActivity, openStudioLive, loadDesignChat, askDesign, answerDesignQuestions, changeDesignPlan, buildDesignPlan, loadLibrary, uploadAsset: postAsset, renameLibraryAsset, deleteLibraryAsset, cancelDesign, importDesignImage, loadStockAvailable, searchStockImages, useStockImage, undoDesignChange, loadDesignText, saveDesignText, loadStudioPages, loadStudioLanguages, publishDesign, publishBefore, loadPublishRun, loadMeters, publishNow, loadHistory, goBackToVersion, previewLink, endPreviewLinks, loadContentList, loadContentEntry, saveContent, deleteContent, loadProductNames, loadContentTranslation, saveContentTranslation }

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

/** `working` is a change on its second check after a repair; `chatStreaming` a chat answer halfway (#1237). */
const sampleLive: Partial<Record<StorefrontState, LiveEvent[]>> = {
  working: [
    { seq: 1, run: 'sample-run', type: 'step', step: 'reading' },
    { seq: 2, run: 'sample-run', type: 'step', step: 'asking' },
    { seq: 3, run: 'sample-run', type: 'text', text: 'I’m adding a reviews section under your products.' },
    { seq: 4, run: 'sample-run', type: 'step', step: 'checking' },
    { seq: 5, run: 'sample-run', type: 'step', step: 'repairing', attempt: 1, of: 3 },
    { seq: 6, run: 'sample-run', type: 'step', step: 'checking' },
  ],
  // #1243: page 2 of 4 of a plan's build, its own steps under it.
  building: [
    { seq: 1, run: 'sample-build', type: 'step', step: 'reading' },
    { seq: 2, run: 'sample-build', type: 'page', index: 1, of: 4, page: 'home', titles: ['Home', 'Product', 'Collection', 'About'] },
    { seq: 3, run: 'sample-build', type: 'step', step: 'asking' },
    { seq: 4, run: 'sample-build', type: 'step', step: 'checking' },
    { seq: 5, run: 'sample-build', type: 'page', index: 2, of: 4, page: 'product', titles: ['Home', 'Product', 'Collection', 'About'] },
    { seq: 6, run: 'sample-build', type: 'step', step: 'asking' },
    { seq: 7, run: 'sample-build', type: 'text', text: 'I’m giving the product page a large gallery with zoom.' },
    { seq: 8, run: 'sample-build', type: 'step', step: 'checking' },
  ],
  chatStreaming: [
    { seq: 1, run: 'sample-chat', type: 'step', step: 'asking' },
    { seq: 2, run: 'sample-chat', type: 'text', text: 'Linen looks best in a calm, airy shop: soft natural tones like oat, sand and stone, plenty of white space, and large photos that show the weave up close. For your home page, I’d' },
  ],
}

/** The studio's sample: a short conversation, and every change accepted at once. */
const sampleStudio = (state: StorefrontState) => {
  const at = '2026-10-12T08:15:00Z'
  const line = (id: string, role: DesignMessage['role'], text: string, more: Partial<DesignMessage> = {}): DesignMessage => ({ id, role, text, changed: [], imageAssetId: null, sampleUrl: null, canUndo: false, undone: false, createdAt: at, questions: [], answers: [], plan: null, flowState: null, build: null, ...more })
  let chat: DesignMessage[] = [
    ...sampleFlow(state, line),
    line('m3', 'ai', 'I warmed up the background and buttons and gave the home page an autumn headline.', { changed: ['Colours', 'Hero headline'], canUndo: !isFlowState(state) }),
    line('m2', 'user', 'Make the colours warmer and give the home page an autumn headline'),
    line('m1', 'note', 'template:classic'),
  ]
  let n = 3
  return {
    loadStudioSession: () => (state === 'ended' ? Promise.reject(new ApiError('SESSION_ENDED', 'Ended.')) : Promise.resolve({ ...sampleSession, ...(sessionStates[state] ?? { state: 'ready' as const, place: null }) })),
    renewStudioSession: () => Promise.resolve(),
    studioActivity: () => Promise.resolve(),
    openStudioLive: (_session: string, onEvent: (event: LiveEvent) => void, onUp: (up: boolean) => void) => {
      onUp(true)
      for (const event of sampleLive[state] ?? []) onEvent(event)
      return { close: () => undefined }
    },
    loadDesignChat: () => Promise.resolve({ messages: chat, next: null }),
    askDesign: (input: { text: string; imageAssetId: string | null; sampleUrl: string | null }) => {
      n += 2
      chat = [line(`m${n}`, 'ai', 'Done — the preview shows it now.', { changed: ['Layout'], canUndo: true }), line(`m${n - 1}`, 'user', input.text, { imageAssetId: input.imageAssetId, sampleUrl: input.sampleUrl }), ...chat.map((m) => ({ ...m, canUndo: false }))]
      return Promise.resolve('changed')
    },
    answerDesignQuestions: (id: string) => {
      chat = [line(`m${(n += 1)}`, 'plan', 'Here’s my plan for your store:', { plan: samplePlan, flowState: 'open' }), ...chat.map((m) => (m.id === id ? { ...m, flowState: 'answered' as const } : m))]
      return Promise.resolve('asked')
    },
    changeDesignPlan: (id: string, words: string) => {
      chat = [line(`m${(n += 2)}`, 'plan', 'I changed the plan:', { plan: { ...samplePlan, pages: [...samplePlan.pages, { page: 'lookbook', title: 'Lookbook', sections: ['large photos from your collections'] }] }, flowState: 'open' }), line(`m${n - 1}`, 'user', words), ...chat.map((m) => (m.id === id ? { ...m, flowState: 'replaced' as const } : m))]
      return Promise.resolve('asked')
    },
    buildDesignPlan: (id: string) => {
      const pages = samplePlan.pages.map((p) => ({ page: p.page, title: p.title, outcome: 'changed' as const }))
      chat = [line(`m${(n += 1)}`, 'ai', '', { changed: pages.map((p) => p.title), canUndo: true, build: { pages, stopped: false } }), ...chat.map((m) => (m.id === id ? { ...m, flowState: 'built' as const } : { ...m, canUndo: false }))]
      return Promise.resolve('changed')
    },
    importDesignImage: () => Promise.resolve('sample-import-1'),
    cancelDesign: () => Promise.resolve(true),
    loadLibrary: () => Promise.resolve({ assets: ['Hero photo', 'Linen close-up', 'Studio', 'Banner'].map((name, i) => ({ id: `sample-asset-${i}`, kind: 'image' as const, mime: 'image/png', bytes: 180_000 + i * 37_000, width: 1200, height: 900, name, uses: i % 3 === 0 ? 1 : 0, createdAt: '2026-10-29T10:00:00Z' })), next: null }),
    uploadAsset: () => Promise.resolve({ ok: true as const, asset: { id: 'sample-upload', kind: 'image', mime: 'image/png', bytes: 1000 } }),
    renameLibraryAsset: () => Promise.resolve(),
    deleteLibraryAsset: () => Promise.resolve(),
    loadStockAvailable: () => Promise.resolve(true),
    searchStockImages: () => Promise.resolve([1, 2, 3, 4, 5, 6].map((n) => ({ id: String(n), source: 'pixabay', thumb: '', user: 'A contributor', pageUrl: 'https://pixabay.com/', tags: 'sample' }))),
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

const samplePlan: NonNullable<DesignMessage['plan']> = {
  header: 'your logo and a short menu',
  footer: 'shipping, returns and contact',
  pages: [
    { page: 'home', title: 'Home', sections: ['hero with your block-print kurtas', '3 collection tiles', 'what shoppers say'] },
    { page: 'product', title: 'Product page', sections: ['large gallery with zoom', 'care notes'] },
    { page: 'collection', title: 'Collection page', sections: ['roomy grid, 3 a row on desktop'] },
    { page: 'about', title: 'About', sections: ['the workshop in Jaipur'] },
  ],
}

const isFlowState = (state: StorefrontState) => state === 'questions' || state === 'plan' || state === 'building' || state === 'built'

/** #1243's states: the questions open, the plan open, the plan building (its pages on the live feed), and the build's entry. */
const sampleFlow = (state: StorefrontState, line: (id: string, role: DesignMessage['role'], text: string, more?: Partial<DesignMessage>) => DesignMessage): DesignMessage[] => {
  if (!isFlowState(state)) return []
  const questions = line('f2', 'questions', 'A few quick questions so I build the right thing. Pick one, type your own, or skip them.', {
    questions: [
      { text: 'What feeling should the store have?', options: ['Calm and premium', 'Warm and handmade', 'Bold and modern'] },
      { text: 'What should the home page lead with?', options: ['Indigo block-print kurta — your best seller', 'Your newest arrivals', 'Your collections'] },
      { text: 'Which language should shoppers see first?', options: ['English (your main language)', 'हिन्दी'] },
    ],
    flowState: state === 'questions' ? 'open' : 'answered',
    answers: state === 'questions' ? [] : ['Calm and premium', 'Indigo block-print kurta — your best seller', 'English (your main language)'],
  })
  const ask = line('f1', 'user', 'Make my store look premium')
  if (state === 'questions') return [questions, ask]
  const plan = line('f3', 'plan', 'Here’s my plan for your store:', { plan: samplePlan, flowState: state === 'plan' ? 'open' : state === 'building' ? 'building' : 'built' })
  if (state !== 'built') return [plan, questions, ask]
  const pages = samplePlan.pages.map((p) => ({ page: p.page, title: p.title, outcome: 'changed' as const }))
  return [line('f4', 'ai', '', { changed: pages.map((p) => p.title), canUndo: true, build: { pages, stopped: false } }), plan, questions, ask]
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
    [12, 11, 10].map((number) => ({ id: `v${number}`, number, template: 'classic', label: number === 12 ? 'Autumn colours and headline' : number === 11 ? 'Add a reviews section' : null, live: number === live, publishedAt: `2026-10-0${number - 3}T10:40:00Z` }))
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
