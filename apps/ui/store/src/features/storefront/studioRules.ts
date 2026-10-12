import { z } from 'zod'
import { scratchTemplate } from '../../api/storefront'
import type { StudioPages } from '../../api/studio'
import { fill, messages } from '../../messages'
import { refusalIn } from '../common/refusal'

const words = messages.storefront.studio

/** How long each studio ahead in the queue is guessed to take, for "You're next — about N seconds". */
export const secondsPerPlace = 20

/** The studio session is renewed every 2 minutes and lives 5 (AI-STUDIO §9, decided on #482). */
export const renewEveryMs = 120_000

/** While the sandbox starts or queues, `studioSession` is read again this often. */
export const openingPollMs = 2_000

/** The frame's origin, only when its address is https, under `/__studio/`, and not the portal's own origin (AI-STUDIO §1, §8). */
export const frameOriginOf = (frameUrl: string, portalOrigin: string): string | null => {
  try {
    const url = new URL(frameUrl)
    return url.protocol === 'https:' && url.pathname.startsWith('/__studio/') && url.origin !== portalOrigin ? url.origin : null
  } catch {
    return null
  }
}

/** A store path inside the frame: relative to the session's base, so the id stays in every request's path. */
export const frameAddress = (frameUrl: string, path: string): string => new URL(path.replace(/^\/+/, ''), frameUrl).toString()

// The studio–frame messages (AI-STUDIO §8, "Built on #319"): the frame reports the page it shows and the words picked for Edit text.
const fromFrame = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('df-studio:page'), path: z.string().regex(/^\/[^\s\\]{0,500}$/) }),
  z.strictObject({ type: z.literal('df-studio:text'), key: z.string().regex(/^[a-z][a-z0-9-]{0,40}:[A-Za-z0-9_.-]{1,200}$/) }),
])
export type FrameMessage = z.infer<typeof fromFrame>

/** A message from the frame, or null for anything from another window or origin, or not in the protocol. */
export const frameMessage = (event: { origin: string; source: unknown; data: unknown }, origin: string, frame: unknown): FrameMessage | null => {
  if (event.origin !== origin || event.source !== frame || frame === null) return null
  const parsed = fromFrame.safeParse(event.data)
  return parsed.success ? parsed.data : null
}

/** Edit text on or off, posted only to the frame's origin. */
export const editModeMessage = (on: boolean) => ({ type: 'df-studio:edit', on }) as const

/** The page a text key belongs to (`pages:home.lead` → `home`); shared words are read with the page shown. */
export const textPageOf = (key: string, shown: string): string => /^pages:([A-Za-z0-9_-]+)\./.exec(key)?.[1] ?? shown

export interface PageGroup {
  label: string
  items: { path: string; label: string }[]
}

const policies = ['terms', 'privacy', 'shipping', 'returns'] as const

/** Every page of the store (FIRST-RELEASE §14): core's routes, the content pages and the AI's own pages (storefront ARCHITECTURE §3.1). */
export const pageGroups = (pages: StudioPages): PageGroup[] => {
  const r = words.routes
  const shop = [
    { path: '/', label: r.home },
    { path: '/collections/all/', label: r.collection },
    ...(pages.product ? [{ path: `/products/${pages.product.slug}/`, label: fill(r.product, { name: pages.product.name }) }] : []),
    { path: '/search/', label: r.search },
    { path: '/cart/', label: r.cart },
    { path: '/checkout/', label: r.checkout },
    { path: '/account/', label: r.account },
    { path: '/sign-in/', label: r.signIn },
  ]
  return [
    { label: words.groups.shop, items: shop },
    { label: words.groups.policies, items: policies.map((p) => ({ path: `/policies/${p}/`, label: r[p] })) },
    { label: words.groups.content, items: pages.content.map((c) => ({ path: c.path, label: c.title })) },
    { label: words.groups.custom, items: pages.custom.map((path) => ({ path, label: path })) },
  ].filter((g) => g.items.length > 0)
}

/** A note's code in the studio's words (`template:linen`, `undone`, `discarded`); null for a code this portal doesn't know. */
export const noteText = (code: string, templateName: (key: string) => string): string | null => {
  const n = words.chat.notes
  const template = /^template:(.+)$/.exec(code)?.[1]
  if (template) return template === scratchTemplate ? n.scratch : fill(n.template, { name: templateName(template) })
  return code === 'undone' ? n.undone : code === 'discarded' ? n.discarded : null
}

export const askRefusal = refusalIn(words.chat.refused)
export const editRefusal = refusalIn(words.edit.refused)

/** A website to take inspiration from: a full https address with a dotted host. */
export const sampleAddress = (raw: string): string | null => {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' && url.hostname.includes('.') ? url.toString() : null
  } catch {
    return null
  }
}

export const languageName = (code: string, locale: string): string => {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}
