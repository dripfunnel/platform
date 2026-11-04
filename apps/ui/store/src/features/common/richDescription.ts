// A product's description is the engine's small HTML subset (#1216); these read it for the editor and for plain text.

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }

const hasMarkup = (text: string): boolean => /<\/?[a-z!]/i.test(text)

const escapeText = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** A stored description as the editor opens it: text typed before the editor was rich becomes paragraphs. */
export const editorHtmlOf = (stored: string): string =>
  hasMarkup(stored)
    ? stored
    : stored
        .replace(/\r\n?/g, '\n')
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p !== '')
        .map((p) => `<p>${escapeText(p).replaceAll('\n', '<br>')}</p>`)
        .join('')

/** The editor's HTML as the engine stores it, so reopening a product and changing nothing is not a change. */
export const storedHtmlOf = (html: string): string => html.replace(/<p>(?:<br[^>]*>)?<\/p>/g, '').replace(/<li><p>((?:(?!<\/p>)[^])*)<\/p><\/li>/g, '<li>$1</li>')

/** What a description says without its formatting, for a placeholder. */
export const plainTextOf = (stored: string): string =>
  (hasMarkup(stored) ? stored.replace(/<\/(?:p|li)>|<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => entities[e] ?? e) : stored).replace(/\s+/g, ' ').trim()
