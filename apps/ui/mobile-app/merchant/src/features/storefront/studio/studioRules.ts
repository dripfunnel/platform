import type { DesignOverview, StudioPages, StudioState } from '../../../api/studio'
import { t } from '../../../messages'

// The studio's rules that need no screen (AI-STUDIO §8; FIRST-RELEASE (store) §14): where its frame may load from, what the page picker lists,
// and the timings the web studio uses.

/** The session lives 5 minutes and is renewed every 2, so one missed renewal never closes the frame (AI-STUDIO §9, decided on #482). */
export const renewEveryMs = 120_000

/** While the sandbox starts or queues, `studioSession` is read again this often. */
export const openingPollMs = 2000

/** How long each studio ahead in the queue is guessed to take, for "You're next — about N seconds" (the web's number). */
export const secondsPerPlace = 20

// React Native's `URL` has no `origin` or `pathname`, so the address is read by pattern.
const framePattern = /^(https:\/\/[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?::\d+)?)\/__studio\/[A-Za-z0-9_-]+\/$/

/** The frame's origin, only for an https `/__studio/{session}/` address that is not the portal's own host: AI-written code never runs there (AI-STUDIO §1, §8). */
export const frameOriginOf = (frameUrl: string, portalHost: string): string | null => {
  const origin = framePattern.exec(frameUrl)?.[1]?.toLowerCase()
  return origin !== undefined && origin !== `https://${portalHost.toLowerCase()}` ? origin : null
}

// No `%`: an encoded dot or slash is never taken for a path segment, so no later decoding can move the frame out of its session.
const storePath = /^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/

/** A store path inside the frame, under the session's base so the id stays in every request's path; anything else shows the home page. */
export const frameAddress = (frameUrl: string, path: string): string => {
  if (!storePath.test(path) || path.split('/').some((segment) => segment === '.' || segment === '..')) return frameUrl
  return `${frameUrl}${path.replace(/^\/+/, '')}`
}

const dotSegment = /(?:^|\/)(?:\.|%2e){1,2}(?=\/|$)/i
const encodedSlash = /%2f|%5c|\\/i

/** The frame may go only to addresses under its own session's base, with no dot segment or encoded slash in the path that a server could resolve out of it. */
export const frameMayLoad = (address: string, frameUrl: string): boolean => {
  if (!address.startsWith(frameUrl)) return false
  const path = address.slice(frameUrl.length).split(/[?#]/)[0] ?? ''
  return !dotSegment.test(path) && !encodedSlash.test(path)
}

/** What the studio's overlay says about the sandbox, from the session the API answered. */
export type Sandbox = { kind: 'opening' } | { kind: 'queued'; place: number } | { kind: 'ready' } | { kind: 'finishing' } | { kind: 'ended' } | { kind: 'failed'; notConnected: boolean }

export const sandboxOf = (state: StudioState, place: number | null): Sandbox =>
  state === 'ready' ? { kind: 'ready' } : state === 'queued' ? { kind: 'queued', place: place ?? 1 } : state === 'busy' ? { kind: 'finishing' } : state === 'unavailable' ? { kind: 'failed', notConnected: false } : { kind: 'opening' }

export const overlayText = (sandbox: Sandbox): string | null => {
  if (sandbox.kind === 'opening') return t('storefront.studio.sandbox.opening')
  if (sandbox.kind === 'queued') return t('storefront.studio.sandbox.queued', { seconds: sandbox.place * secondsPerPlace })
  if (sandbox.kind === 'finishing') return t('storefront.studio.sandbox.finishing')
  if (sandbox.kind === 'ended') return t('storefront.studio.sandbox.ended')
  if (sandbox.kind === 'failed') return t(sandbox.notConnected ? 'storefront.studio.sandbox.notConnected' : 'storefront.studio.sandbox.unavailable')
  return null
}

export type PageOption = { value: string; label: string; group: string }

const policies = ['terms', 'privacy', 'shipping', 'returns'] as const

/** Every page of the store (FIRST-RELEASE (store) §14): core's routes, the content pages and the AI's own pages (storefront ARCHITECTURE §3.1). */
export const pageOptions = (pages: StudioPages): PageOption[] => {
  const shop = t('storefront.studio.groups.shop')
  return [
    { value: '/', label: t('storefront.studio.routes.home'), group: shop },
    { value: '/collections/all/', label: t('storefront.studio.routes.collection'), group: shop },
    ...(pages.product ? [{ value: `/products/${pages.product.slug}/`, label: t('storefront.studio.routes.product', { name: pages.product.name }), group: shop }] : []),
    { value: '/search/', label: t('storefront.studio.routes.search'), group: shop },
    { value: '/cart/', label: t('storefront.studio.routes.cart'), group: shop },
    { value: '/checkout/', label: t('storefront.studio.routes.checkout'), group: shop },
    { value: '/account/', label: t('storefront.studio.routes.account'), group: shop },
    { value: '/sign-in/', label: t('storefront.studio.routes.signIn'), group: shop },
    ...policies.map((policy) => ({ value: `/policies/${policy}/`, label: t(`storefront.studio.routes.${policy}`), group: t('storefront.studio.groups.policies') })),
    ...pages.content.map((page) => ({ value: page.path, label: page.title, group: t('storefront.studio.groups.content') })),
    ...pages.custom.map((path) => ({ value: path, label: path, group: t('storefront.studio.groups.custom') })),
  ]
}

/** A website to take inspiration from: a full https address with a dotted host. */
export const sampleAddress = (typed: string): string | null => {
  const address = typed.trim()
  return /^https:\/\/[^\s/]+\.[^\s/]+(?:[/?#]\S*)?$/i.test(address) ? address : null
}

/** A note's code in the studio's words (`template:linen`, `undone`, `discarded`); null for a code this app doesn't know. */
export const noteText = (code: string, templateName: (key: string) => string): string | null => {
  const template = /^template:(.+)$/.exec(code)?.[1]
  if (template) return template === 'baseline' ? t('storefront.studio.chat.notes.scratch') : t('storefront.studio.chat.notes.template', { name: templateName(template) })
  return code === 'undone' ? t('storefront.studio.chat.notes.undone') : code === 'discarded' ? t('storefront.studio.chat.notes.discarded') : null
}

/** The number the next publish will take. */
export const nextVersionOf = (overview: DesignOverview): number => Math.max(overview.live?.number ?? 0, ...overview.history.map((version) => version.number)) + 1
