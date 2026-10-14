// Edit text (FIRST-RELEASE §14): a theme's words live in content/{locale}/{file}.json (storefront ARCHITECTURE §3.4);
// a key is `{file}:{dotted.path}`, so `pages:home.lead` is pages.json's home.lead.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

const isObject = (v: Json | undefined): v is { [key: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v)

const parse = (text: string | undefined): Json | undefined => {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as Json
  } catch {
    return undefined
  }
}

const strings = (value: Json, prefix: string): { key: string; text: string }[] => {
  if (typeof value === 'string') return [{ key: prefix, text: value }]
  if (!isObject(value)) return []
  return Object.entries(value).flatMap(([k, v]) => strings(v, prefix.endsWith(':') ? `${prefix}${k}` : `${prefix}.${k}`))
}

/** The page's own words (pages.json under the page's name) and every other content file's (common.json, home.json, …). */
export const pageTexts = (theme: ReadonlyMap<string, string>, page: string, locale: string): { key: string; text: string }[] => {
  const pages = parse(theme.get(`content/${locale}/pages.json`))
  const own = isObject(pages) && pages[page] !== undefined ? strings(pages[page], `pages:${page}`) : []
  const file = new RegExp(`^content/${locale}/([a-z][a-z0-9-]{0,40})\\.json$`)
  const others = [...theme].flatMap(([path, text]) => {
    const name = file.exec(path)?.[1]
    const value = name && name !== 'pages' ? parse(text) : undefined
    return value === undefined ? [] : strings(value, `${name}:`)
  })
  return [...own, ...others]
}

/** The file with the one string at `key` replaced, or null when the key names no string there (nothing is added). */
export const withText = (theme: ReadonlyMap<string, string>, locale: string, key: string, text: string): { path: string; content: string } | null => {
  const m = /^([a-z][a-z0-9-]{0,40}):([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,9})$/.exec(key)
  if (!m?.[1] || !m[2] || !/^[a-z]{2,3}$/.test(locale)) return null
  const path = `content/${locale}/${m[1]}.json`
  const root = parse(theme.get(path))
  const parts = m[2].split('.')
  const last = parts.pop()
  let node: Json | undefined = root
  for (const part of parts) node = isObject(node) ? node[part] : undefined
  if (!last || !isObject(node) || typeof node[last] !== 'string') return null
  node[last] = text
  return { path, content: `${JSON.stringify(root, null, 2)}\n` }
}
