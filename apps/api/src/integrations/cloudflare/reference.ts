import { z } from 'zod'

// A sample site's measured design (storefront ARCHITECTURE §6.2): Browser Rendering opens the page and a script of ours reads
// its fonts, colours, sections and pictures. Everything read is the third party's text: capped, schema-checked, never trusted.

export interface ReferenceReader {
  /** The page as measured at the device's width; null when it couldn't be read. */
  read: (url: URL, device: 'desktop' | 'tablet' | 'phone') => Promise<ReferencePage | null>
}

const widths = { desktop: 1440, tablet: 834, phone: 390 } as const
const timeoutMs = 35_000
const maxHtml = 3 * 1024 * 1024
export const maxReferenceSections = 14
export const maxReferenceImages = 16

const text = (max: number) => z.string().max(max)
const color = text(60)
const px = z.number().int().min(0).max(100_000)

export const referencePageSchema = z.strictObject({
  title: text(120),
  fonts: z.strictObject({ heading: text(160), body: text(160), button: text(160) }),
  googleFonts: z.array(text(60)).max(6),
  colors: z.strictObject({ page: color, text: color, heading: color, button: color, buttonText: color }),
  nav: z.array(text(40)).max(12),
  height: px,
  sections: z.array(z.strictObject({ tag: text(10), top: px, height: px, background: color, heading: text(120), text: text(200) })).max(maxReferenceSections),
  images: z
    .array(z.strictObject({ src: text(2048), alt: text(120), width: px, height: px, section: z.number().int().min(-1).max(maxReferenceSections), product: z.boolean() }))
    .max(maxReferenceImages),
})
export type ReferencePage = z.infer<typeof referencePageSchema>

/** Runs in the reference page: reads what is drawn and leaves it as JSON under `id`, with `<` escaped so it can't end the element. */
const measure = (id: string, sections: number, images: number) => `(() => {
  const clip = (s, n) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, n);
  const css = (el, p) => (el ? getComputedStyle(el)[p] || '' : '').slice(0, 160);
  const heading = document.querySelector('h1, h2');
  const para = document.querySelector('main p, section p, p') || document.body;
  const button = document.querySelector('button, a[class*="btn"], a[class*="button"]');
  const pageBg = css(document.body, 'backgroundColor') === 'rgba(0, 0, 0, 0)' ? css(document.documentElement, 'backgroundColor') : css(document.body, 'backgroundColor');
  const blocks = [...document.querySelectorAll('header, section, footer')].filter((el) => !el.parentElement.closest('header, section, footer') && el.getBoundingClientRect().height >= 40).slice(0, ${sections});
  const top = (el) => Math.max(0, Math.round(el.getBoundingClientRect().top + scrollY));
  const out = {
    title: clip(document.title, 120),
    fonts: { heading: css(heading, 'fontFamily'), body: css(para, 'fontFamily'), button: css(button, 'fontFamily') },
    googleFonts: [...new Set([...document.querySelectorAll('link[href*="fonts.googleapis.com"]')].flatMap((l) => { try { return new URL(l.href).searchParams.getAll('family').map((f) => clip(f.split(':')[0], 60)); } catch { return []; } }))].slice(0, 6),
    colors: { page: pageBg.slice(0, 60), text: css(para, 'color').slice(0, 60), heading: css(heading, 'color').slice(0, 60), button: css(button, 'backgroundColor').slice(0, 60), buttonText: css(button, 'color').slice(0, 60) },
    nav: [...new Set([...document.querySelectorAll('header nav a, header a')].map((a) => clip(a.textContent, 40)).filter(Boolean))].slice(0, 12),
    height: Math.round(document.documentElement.scrollHeight),
    sections: blocks.map((el) => ({ tag: el.tagName.toLowerCase().slice(0, 10), top: top(el), height: Math.round(el.getBoundingClientRect().height), background: (css(el, 'backgroundImage') !== 'none' ? 'picture' : css(el, 'backgroundColor')).slice(0, 60), heading: clip(el.querySelector('h1, h2, h3') && el.querySelector('h1, h2, h3').textContent, 120), text: clip(el.querySelector('p') && el.querySelector('p').textContent, 200) })),
    // By the size drawn, not the size loaded: a lazy picture below the fold hasn't loaded yet.
    images: [...document.images]
      .map((img) => ({ img, src: img.currentSrc || img.src, box: img.getBoundingClientRect() }))
      .filter(({ src, box }) => src.startsWith('https://') && box.width >= 120 && box.height >= 80)
      .map(({ img, src, box }) => ({ src: src.slice(0, 2048), alt: clip(img.alt, 120), width: img.naturalWidth || Math.round(box.width), height: img.naturalHeight || Math.round(box.height), section: blocks.findIndex((b) => b.contains(img)), product: !!img.closest('a[href*="/product"]'), area: box.width * box.height }))
      .sort((a, b) => b.area - a.area)
      .slice(0, ${images})
      .map(({ area, ...img }) => img),
  };
  const el = document.createElement('script');
  el.type = 'application/json';
  el.id = '${id}';
  el.textContent = JSON.stringify(out).replace(/</g, '\\\\u003c');
  document.head.appendChild(el);
})()`

const envelope = z.object({ success: z.literal(true), result: z.string().max(maxHtml) })

export const browserReference = ({ accountId, token, fetchImpl = fetch, newId = () => crypto.randomUUID() }: { accountId: string; token: string; fetchImpl?: typeof fetch; newId?: () => string }): ReferenceReader => ({
  read: async (url, device) => {
    // A fresh id each read, so a page can't plant an answer of its own under it.
    const id = `df-${newId()}`
    let response: Response
    try {
      response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          url: url.href,
          viewport: { width: widths[device], height: Math.round(widths[device] * 0.75) },
          gotoOptions: { waitUntil: 'networkidle0', timeout: 25_000 },
          addScriptTag: [{ content: measure(id, maxReferenceSections, maxReferenceImages) }],
          rejectResourceTypes: ['media'],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      return null
    }
    if (!response.ok) return null
    const body = envelope.safeParse(await response.json().catch(() => null))
    if (!body.success) return null
    const opening = `<script type="application/json" id="${id}">`
    const start = body.data.result.indexOf(opening)
    const end = start < 0 ? -1 : body.data.result.indexOf('</script>', start)
    if (end < 0) return null
    let raw: unknown
    try {
      raw = JSON.parse(body.data.result.slice(start + opening.length, end))
    } catch {
      return null
    }
    const page = referencePageSchema.safeParse(raw)
    return page.success ? page.data : null
  },
})
