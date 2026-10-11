// The pages the edge Worker writes itself (storefront LIVE-SHOP.md §5 step 2, PREVIEW.md §5 step 3). None shows store data
// beyond the shop's own name on its own host, and none carries a DripFunnel contact route (SAAS §4.2).

type PageKind = 'closed' | 'degraded' | 'missing'

const messages: Record<string, Record<PageKind, { title: string; body: string }>> = {
  en: {
    closed: { title: 'This preview has closed', body: 'Open it again from your link or from the portal.' },
    degraded: { title: 'This shop is unavailable right now', body: 'Please contact the shop directly.' },
    missing: { title: 'Page not found', body: 'There is nothing at this address.' },
  },
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const wordsFor = (language: string) => messages[language.split('-')[0] ?? ''] ?? messages['en']

export const page = (kind: PageKind, status: number, options: { language?: string; heading?: string; headers?: Record<string, string> } = {}): Response => {
  const language = options.language ?? 'en'
  const words = wordsFor(language)?.[kind] ?? { title: '', body: '' }
  const heading = options.heading ? `<p>${escape(options.heading)}</p>` : ''
  const html = `<!doctype html><html lang="${escape(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(words.title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">${heading}<h1>${escape(words.title)}</h1><p>${escape(words.body)}</p></body></html>`
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
      ...options.headers,
    },
  })
}
