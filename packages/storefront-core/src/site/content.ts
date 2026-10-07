import type { Site } from './schema'

/** The template's look with the merchant's words kept: menu, announcement, footer, About, Contact and the hero's words. */
export const keepContent = (template: Site, current: Site | undefined): Site => {
  if (!current) return template
  const out: Site = structuredClone(template)
  out.header.menu = [...current.header.menu]
  out.announce = { ...out.announce, on: current.announce.on, text: current.announce.text }
  out.footer = { ...out.footer, text: current.footer.text, links: [...current.footer.links] }
  out.pages = structuredClone(current.pages)
  const hero = current.sections.find((s) => s.type === 'hero')
  out.sections = out.sections.map((s) => (s.type === 'hero' && hero?.type === 'hero' ? { ...s, headline: hero.headline, sub: hero.sub, cta: hero.cta } : s))
  return out
}

export type ChangedPart = 'announce' | 'header' | 'footer' | 'pages' | 'theme' | string

/** What differs between two sites: the parts by name and the home sections by id (the studio's "Changed" marks). */
export const changedParts = (before: Site, after: Site): ChangedPart[] => {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const parts: ChangedPart[] = (['theme', 'announce', 'header', 'footer'] as const).filter((k) => !same(before[k], after[k]))
  const old = new Map(before.sections.map((s) => [s.id, s]))
  for (const s of after.sections) if (!same(old.get(s.id), s)) parts.push(s.id)
  if (!same(before.pages, after.pages)) parts.push('pages')
  return parts
}
