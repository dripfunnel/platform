import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyCodemods, coreUpgradeNotes, notesBetween, validateTheme } from '@dripfunnel/storefront-core/guard'

// #1598: the 2.0.1 codemods turn each starting theme as it was before its loading skeletons into the one the template ships now.
const themesDir = fileURLToPath(new URL('../../../templates/storefront/themes/', import.meta.url))
const walk = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel)).flatMap((name) => {
    const path = rel ? `${rel}/${name}` : name
    return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path]
  })
const shipped = (theme: string) =>
  new Map(
    walk(join(themesDir, theme), 'src/theme')
      .filter((path) => /\.(tsx|css)$/.test(path))
      .map((path) => [path, readFileSync(join(themesDir, theme, path), 'utf8').replace(/\r\n/g, '\n')] as const),
  )
const codemods = notesBetween('2.0.0', '2.0.1', coreUpgradeNotes).flatMap((n) => n.codemods)

/** The theme with every codemod undone, last first: what a store made before the skeletons holds. */
const undone = (theme: ReadonlyMap<string, string>) => {
  const files = new Map(theme)
  for (const c of [...codemods].reverse()) {
    if (c.kind !== 'replace') continue
    for (const path of c.paths) {
      const text = files.get(path)
      if (text?.includes(c.replace)) files.set(path, text.replace(c.replace, c.find))
    }
  }
  return files
}

describe.each(['baseline', 'beauty', 'classic', 'electronics', 'fashion', 'grocery', 'home', 'jewelry'])('the loading skeletons for a %s store made before core 2.0.1', (key) => {
  const now = shipped(key)
  const before = undone(now)

  it('has the skeletons taken out of the fixture, so the test means something', () => {
    for (const text of before.values()) expect(text).not.toMatch(/skeleton(Text|Short|Title|Photo|Cover|Dot|Button)|srOnly/)
  })

  it('brings the shipped theme back exactly, and a second run changes nothing', () => {
    const once = applyCodemods(before, codemods)
    expect(once).toEqual(now)
    expect(applyCodemods(once, codemods)).toEqual(once)
  })
})

// Market's cart, collection and product pages ship Classic's markup, so an existing Market store gets those skeletons too.
describe('a Market store upgraded to core 2.0.1', () => {
  const before = shipped('market')
  const after = applyCodemods(before, codemods)
  const changed = [...after.keys()].filter((path) => after.get(path) !== before.get(path))

  it('changes only the pages and styles that ship Classic markup', () => {
    expect(changed.sort()).toEqual(['src/theme/components/ProductCard.tsx', 'src/theme/components/interactive/CartView.tsx', 'src/theme/pages/CollectionPage.tsx', 'src/theme/pages/ProductPage.tsx', 'src/theme/styles/product.module.css', 'src/theme/styles/shop.module.css'])
  })

  it('styles every class the rewritten pages use from its CSS Modules', () => {
    for (const path of changed.filter((p) => p.endsWith('.tsx'))) {
      const code = after.get(path) ?? ''
      for (const [, name, module] of code.matchAll(/^import (\w+) from '[./]*\/?styles\/(\w+)\.module\.css'$/gm)) {
        const css = after.get(`src/theme/styles/${module}.module.css`) ?? ''
        for (const [, cls] of code.replace(/^import .*$/gm, '').matchAll(new RegExp(`(?<![\\w.'])${name}\\.(\\w+)`, 'g'))) expect(css, `${path}: ${name}.${cls}`).toMatch(new RegExp(`\\.${cls}\\b`))
      }
    }
  })

  it('passes the validator', async () => {
    const files = [...after].map(([path, content]) => ({ path, content }))
    const all = walk(join(themesDir, 'market'), '').filter((p) => !after.has(p) && p !== 'template.json' && !p.startsWith('src/theme/media/'))
    for (const path of all) files.push({ path, content: readFileSync(join(themesDir, 'market', path), 'utf8') })
    const brand = { name: 'Northstar Linen', tagline: 'Linen clothes, made slowly', email: 'hello@northstar.example', phone: '+91 98450 22113', address: ['12 Residency Road', 'Bengaluru'], socialLinks: [] }
    expect((await validateTheme(files, { locales: ['en'], usedPaths: [], mediaIds: [], brand })).problems).toEqual([])
  })
})
