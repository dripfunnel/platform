import { describe, expect, it } from 'vitest'
import { applyCodemods, baselineWithOwn, changesBetween, pinCore } from './apply'
import { codemodSchema, compareVersions, coreUpgradeNotes, notesBetween, upgradeNoteSchema, type UpgradeNote } from './notes'

const theme = new Map([
  ['src/theme/pages/HomePage.tsx', "import { Price } from '@dripfunnel/storefront-core/theme'\nexport const HomePage = () => <Price />\n"],
  ['src/theme/components/Card.tsx', "import { Price } from '@dripfunnel/storefront-core/theme'\n"],
  ['src/theme/styles/page.module.css', '.page { color: var(--ink); }\n'],
  ['content/en/pages.json', '{"home":{"title":"Hi"}}\n'],
])

const note = (version: string, extra: Partial<UpgradeNote> = {}): UpgradeNote => ({ version, kind: 'minor', security: false, notes: `Notes for ${version}`, codemods: [], ...extra })

describe('the release notes', () => {
  it('every entry core ships is in the documented shape, one per version', () => {
    for (const n of coreUpgradeNotes) expect(upgradeNoteSchema.parse(n)).toEqual(n)
    expect(new Set(coreUpgradeNotes.map((n) => n.version)).size).toBe(coreUpgradeNotes.length)
  })

  it('refuses a codemod that names a path outside the theme', () => {
    expect(codemodSchema.safeParse({ kind: 'rename', from: 'src/theme/pages/A.tsx', to: '.github/workflows/build.yml' }).success).toBe(false)
    expect(codemodSchema.safeParse({ kind: 'replace', paths: ['src/theme/**/*.tsx'], find: 'a', replace: 'b', run: 'rm' }).success).toBe(false)
  })

  it('takes the notes after the store’s version up to the target, oldest first, by semver and not by text', () => {
    const notes = [note('1.10.0'), note('1.2.0'), note('1.9.1'), note('2.0.0', { kind: 'major' })]
    expect(notesBetween('1.2.0', '1.10.0', notes).map((n) => n.version)).toEqual(['1.9.1', '1.10.0'])
    expect(notesBetween('1.10.0', '1.10.0', notes)).toEqual([])
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.0.0-dev.10', '0.0.0-dev.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0-dev.3')).toBeGreaterThan(0)
    expect(compareVersions('0.0.0-dev.7', '0.0.0-dev.7')).toBe(0)
  })
})

describe('the codemods', () => {
  it('replace literally in the files their globs match, in order, and rename a file', () => {
    const after = applyCodemods(theme, [
      { kind: 'replace', paths: ['src/theme/**/*.tsx'], find: '{ Price }', replace: '{ PriceTag }' },
      { kind: 'replace', paths: ['src/theme/pages/*.tsx'], find: '<Price />', replace: '<PriceTag />' },
      { kind: 'rename', from: 'src/theme/components/Card.tsx', to: 'src/theme/components/ProductCard.tsx' },
    ])
    expect(after.get('src/theme/pages/HomePage.tsx')).toContain('<PriceTag />')
    expect(after.get('src/theme/pages/HomePage.tsx')).toContain('{ PriceTag }')
    expect(after.has('src/theme/components/Card.tsx')).toBe(false)
    expect(after.get('src/theme/components/ProductCard.tsx')).toContain('{ PriceTag }')
    expect(after.get('src/theme/styles/page.module.css')).toBe(theme.get('src/theme/styles/page.module.css'))
    expect(changesBetween(theme, after).map((c) => [c.path, c.content === null])).toEqual([
      ['src/theme/components/Card.tsx', true],
      ['src/theme/components/ProductCard.tsx', false],
      ['src/theme/pages/HomePage.tsx', false],
    ])
  })

  it('leaves a theme a codemod doesn’t match, and never renames over an existing file', () => {
    const after = applyCodemods(theme, [
      { kind: 'replace', paths: ['src/theme/styles/*.css'], find: '{ Price }', replace: 'x' },
      { kind: 'rename', from: 'src/theme/pages/HomePage.tsx', to: 'src/theme/components/Card.tsx' },
      { kind: 'rename', from: 'src/theme/pages/Missing.tsx', to: 'src/theme/pages/Other.tsx' },
    ])
    expect(changesBetween(theme, after)).toEqual([])
  })

  it('pins core exactly and keeps the rest of package.json', () => {
    const pinned = JSON.parse(pinCore('{"name":"sf-x","dependencies":{"@dripfunnel/storefront-core":"1.0.0","react":"19"},"private":true}', '1.1.0')) as Record<string, unknown>
    expect(pinned).toEqual({ name: 'sf-x', dependencies: { '@dripfunnel/storefront-core': '1.1.0', react: '19' }, private: true })
    expect(() => pinCore('[]', '1.1.0')).toThrow()
  })
})

describe('the baseline theme with the store’s own words and tokens', () => {
  const baseline = new Map([
    ['src/theme/pages/HomePage.tsx', 'export const HomePage = () => null\n'],
    ['src/theme/styles/layout.module.css', '.shell { --brand: #111111; --font: serif; --space: 8px; color: var(--brand); }\n'],
    ['content/en/home.json', '{"hero":{"title":"Welcome","lead":"Shop the range"},"cta":"Browse"}\n'],
    ['routes.json', '{}\n'],
  ])
  const own = new Map([
    ['src/theme/pages/HomePage.tsx', 'export const HomePage = () => <Broken />\n'],
    ['src/theme/pages/LookbookPage.tsx', 'export const LookbookPage = () => null\n'],
    ['src/theme/styles/tokens.module.css', '.root { --brand: #e11d48; --font: "Inter", sans-serif; }\n'],
    ['content/en/home.json', '{"hero":{"title":"Linen for slow days"},"cta":{"nested":"x"},"extra":"kept out"}\n'],
    ['content/hi/home.json', '{"hero":{"lead":"हाथ से बना"}}\n'],
    ['routes.json', '{"custom":{"/lookbook":"LookbookPage"}}\n'],
  ])

  it('keeps the baseline’s code and routes, and the store’s colours and fonts', () => {
    const files = baselineWithOwn(baseline, own)
    expect(files.get('src/theme/pages/HomePage.tsx')).toBe(baseline.get('src/theme/pages/HomePage.tsx'))
    expect(files.has('src/theme/pages/LookbookPage.tsx')).toBe(false)
    expect(files.get('routes.json')).toBe('{}\n')
    expect(files.get('src/theme/styles/layout.module.css')).toBe('.shell { --brand: #e11d48; --font: "Inter", sans-serif; --space: 8px; color: var(--brand); }\n')
  })

  it('writes the baseline’s keys in each of the store’s languages, with the store’s words where it has the same key', () => {
    const files = baselineWithOwn(baseline, own)
    expect(JSON.parse(files.get('content/en/home.json') ?? '')).toEqual({ hero: { title: 'Linen for slow days', lead: 'Shop the range' }, cta: 'Browse' })
    expect(JSON.parse(files.get('content/hi/home.json') ?? '')).toEqual({ hero: { title: 'Welcome', lead: 'हाथ से बना' }, cta: 'Browse' })
  })

  it('falls back to the baseline’s own languages for a store with no words', () => {
    const files = baselineWithOwn(baseline, new Map([['src/theme/pages/HomePage.tsx', 'x']]))
    expect([...files.keys()].filter((p) => p.startsWith('content/'))).toEqual(['content/en/home.json'])
  })
})
