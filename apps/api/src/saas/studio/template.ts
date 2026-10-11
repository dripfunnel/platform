import type { FileChange } from '#integrations/sandbox/index'

// "Change template" as one change to the draft (SAAS §9.2): the template's theme replaces the draft's, with a content
// folder for every language the store offers (the validator refuses a missing one, storefront ARCHITECTURE §3.4).

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

const contentPath = /^content\/([a-z]{2,3})\/(.+\.json)$/

const parse = (text: string | undefined): Json | undefined => {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as Json
  } catch {
    return undefined
  }
}

const isObject = (v: Json | undefined): v is { [key: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The template's words, each replaced by the draft's at the same key when the draft has words there ("Keep my words"). */
const keepWords = (template: Json, mine: Json | undefined): Json => {
  if (typeof template === 'string') return typeof mine === 'string' && mine.trim() !== '' ? mine : template
  if (isObject(template)) return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, keepWords(v, isObject(mine) ? mine[k] : undefined)]))
  return template
}

/**
 * The files that make the draft the template: every template file written, every other theme file removed. A language
 * the template has no words for starts from the template's first; with `keep`, the draft's words stay wherever they fit.
 */
export const templateChange = (current: ReadonlyMap<string, string>, template: readonly { path: string; content: string }[], locales: readonly string[], keep: boolean): FileChange[] => {
  const code = template.filter((f) => !contentPath.test(f.path))
  const content = new Map<string, Map<string, string>>()
  for (const f of template) {
    const m = contentPath.exec(f.path)
    if (!m?.[1] || !m[2]) continue
    const files = content.get(m[1]) ?? new Map<string, string>()
    files.set(m[2], f.content)
    content.set(m[1], files)
  }
  const fallback = content.get('en') ?? [...content.values()][0] ?? new Map<string, string>()
  const written = new Map(code.map((f) => [f.path, f.content]))
  for (const locale of locales) {
    for (const [name, text] of content.get(locale) ?? fallback) {
      const path = `content/${locale}/${name}`
      const words = parse(text)
      written.set(path, keep && words !== undefined ? `${JSON.stringify(keepWords(words, parse(current.get(path))), null, 2)}\n` : text)
    }
  }
  const removed = [...current.keys()].filter((path) => !written.has(path))
  return [...removed.map((path) => ({ path, content: null })), ...[...written].map(([path, text]) => ({ path, content: text }))]
}
