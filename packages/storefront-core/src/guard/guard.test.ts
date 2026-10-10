import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { maxFileBytes, maxFiles, maxThemeBytes, ruleIds, validateChange, type GuardContext, type Problem, type RuleId, type ThemeFile } from './index'

// The first case builds the TypeScript program with the DOM's types, which takes over 10 s on CI's runners.
vi.setConfig({ testTimeout: 30_000 })

const fixtures = decodeURIComponent(new URL('./fixtures/', import.meta.url).pathname)

const readTree = (dir: string): ThemeFile[] =>
  ts.sys
    .readDirectory(dir, undefined, undefined, ['**/*', '.github/**/*'])
    .map((file) => ({ path: file.slice(dir.length + 1), content: ts.sys.readFile(file) ?? '' }))
    .filter((f) => f.path !== 'case.json')

const baseline = readTree(`${fixtures}baseline`)

const context: GuardContext = {
  locales: ['en', 'hi'],
  usedPaths: ['/faq', '/blog/summer-edit'],
  brand: {
    name: 'Northstar Linen',
    tagline: 'Slow-made linen for warm days',
    email: 'hello@northstar.example',
    phone: '+91 98765 43210',
    address: ['12 Residency Road', 'Bengaluru 560025'],
    socialLinks: ['https://instagram.com/northstarlinen'],
  },
}

/** The baseline with a change's files laid over it and any paths it removes left out. */
const changed = (overlay: readonly ThemeFile[], remove: readonly string[] = []): ThemeFile[] => {
  const replaced = new Set([...overlay.map((f) => f.path), ...remove])
  return [...baseline.filter((f) => !replaced.has(f.path)), ...overlay]
}

/** One refused change: the rule that must refuse it at its file and line, and any other rule the same code breaks. */
type Case = { name: string; rule: RuleId; file: string | null; line: number | null; files: ThemeFile[]; remove?: string[]; also?: RuleId[] }

const corpus: Case[] = ts.sys.getDirectories(`${fixtures}refused`).map((name) => {
  const dir = `${fixtures}refused/${name}`
  const spec = JSON.parse(ts.sys.readFile(`${dir}/case.json`) ?? '{}') as Omit<Case, 'name' | 'files'>
  return { name, ...spec, files: readTree(dir) }
})

const at = (p: Problem) => ({ file: p.file, line: p.line, rule: p.rule })

describe('validateChange: the baseline theme', () => {
  it('passes with no problem', () => {
    expect(validateChange(baseline, context)).toEqual({ ok: true, problems: [] })
  })
})

describe('validateChange: the refused corpus, one case per rule (fixtures/refused)', () => {
  it.each(corpus)('$name is refused whole, by $rule at $file:$line', ({ files, remove, rule, file, line, also = [] }) => {
    const result = validateChange(changed(files, remove), context)
    expect(result.ok).toBe(false)
    expect(result.problems.map(at)).toContainEqual({ file, line, rule })
    expect(new Set(result.problems.map((p) => p.rule))).toEqual(new Set([rule, ...also]))
    for (const p of result.problems) expect(p.message.length).toBeGreaterThan(20)
  })
})

const accepted = ts.sys.getDirectories(`${fixtures}allowed`).map((name) => ({ name, files: readTree(`${fixtures}allowed/${name}`) }))

describe('validateChange: the accepted corpus, honest code each rule must let through (fixtures/allowed)', () => {
  it.each(accepted)('$name passes', ({ files }) => {
    expect(validateChange(changed(files), context).problems).toEqual([])
  })
})

const page = (path: string, content = 'export const X = () => null\n'): ThemeFile => ({ path, content })
const padded = (path: string, bytes: number): ThemeFile => page(path, `//${'x'.repeat(bytes - 2)}`)

/** Cases a file on disk can't hold: names the disk refuses, links, and sizes too big to keep in the repo. */
const generated: [name: string, files: ThemeFile[], rule: RuleId, file: string | null][] = [
  ['a path that climbs out of the theme', [page('src/theme/pages/../../../package.json')], 'files/path-not-allowed', 'src/theme/pages/../../../package.json'],
  ['a path with a backslash', [page('src/theme/pages\\..\\x.tsx')], 'files/path-not-allowed', 'src/theme/pages\\..\\x.tsx'],
  ['an absolute path', [page('/src/theme/pages/X.tsx')], 'files/path-not-allowed', '/src/theme/pages/X.tsx'],
  ['a look-alike letter in a folder name', [page('src/thеme/pages/X.tsx')], 'files/path-not-allowed', 'src/thеme/pages/X.tsx'],
  ['a file in the locked route shims', [page('src/app/page.tsx')], 'files/path-not-allowed', 'src/app/page.tsx'],
  ['a link', [{ ...page('src/theme/pages/AboutPage.tsx'), symlink: true }], 'files/symlink', 'src/theme/pages/AboutPage.tsx'],
  ['two names one disk folds together', [page('src/theme/pages/Extra.tsx'), page('src/theme/pages/extra.tsx')], 'files/duplicate-path', 'src/theme/pages/extra.tsx'],
  ['a file over its cap', [padded('src/theme/pages/Big.tsx', maxFileBytes + 1)], 'files/file-too-large', 'src/theme/pages/Big.tsx'],
  ['too many files', Array.from({ length: maxFiles - baseline.length + 1 }, (_, i) => page(`src/theme/components/C${i}.tsx`)), 'files/too-many-files', null],
  [
    'a theme over its total cap',
    Array.from({ length: Math.ceil(maxThemeBytes / maxFileBytes) + 1 }, (_, i) => padded(`src/theme/components/C${i}.tsx`, maxFileBytes)),
    'files/theme-too-large',
    null,
  ],
]

describe('validateChange: the file rules for what a fixture on disk cannot hold', () => {
  it.each(generated)('refuses %s', (_, files, rule, file) => {
    const result = validateChange(changed(files), context)
    expect(result.ok).toBe(false)
    expect(result.problems).toContainEqual(expect.objectContaining({ rule, file }))
  })

  it('accepts a file exactly at its cap and a theme of exactly the most files', () => {
    const full = Array.from({ length: maxFiles - baseline.length - 1 }, (_, i) => page(`src/theme/components/C${i}.tsx`))
    expect(validateChange(changed([...full, padded('src/theme/components/Big.tsx', maxFileBytes)]), context).ok).toBe(true)
  })
})

describe('validateChange: a change is judged whole', () => {
  it('refuses a change with one bad file among good ones, naming that file and its line', () => {
    const good = page('src/theme/components/Fine.tsx')
    const words = JSON.parse(baseline.find((f) => f.path === 'content/en/pages.json')?.content ?? '{}') as Record<string, Record<string, string>>
    const bad = { path: 'content/en/pages.json', content: JSON.stringify({ ...words, about: { ...words.about, lead: 'Only 2 left, hurry.' } }, null, 2) }
    const result = validateChange(changed([good, bad]), context)
    expect(result.ok).toBe(false)
    expect(result.problems.map(at)).toEqual([
      { file: 'content/en/pages.json', line: 66, rule: 'content/scarcity' },
      { file: 'content/en/pages.json', line: 66, rule: 'content/urgency' },
    ])
  })
})

describe('validateChange: routes and the store paths', () => {
  const routes = (custom: Record<string, string>) => {
    const parsed = JSON.parse(baseline.find((f) => f.path === 'routes.json')?.content ?? '{}') as object
    return { path: 'routes.json', content: JSON.stringify({ ...parsed, custom }, null, 2) }
  }

  it('compares a custom path with the store paths whatever their case, slashes or encoding', () => {
    const store = { ...context, usedPaths: ['/Lookbook/', '/journal%2Fspring'] }
    expect(validateChange(changed([routes({ '/lookbook': 'AboutPage' })]), store).problems.map((p) => p.rule)).toEqual(['routes/path-in-use'])
    expect(validateChange(changed([routes({ '/journal/spring': 'AboutPage' })]), store).problems.map((p) => p.rule)).toEqual(['routes/path-in-use'])
  })

  it('reserves the store language codes, and accepts a path that only starts like a reserved one', () => {
    expect(validateChange(changed([routes({ '/hi/about': 'AboutPage' })]), context).problems.map((p) => p.rule)).toEqual(['routes/path-reserved'])
    expect(validateChange(changed([routes({ '/carts-of-flowers': 'AboutPage', '/lookbook/summer': 'AboutPage' })]), context).ok).toBe(true)
  })
})

describe('the built validator', () => {
  it('names the .js file in every relative import it reaches, so it runs in plain Node in the sandbox', () => {
    const seen = new Set<string>()
    const bare: string[] = []
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const [, spec = ''] of (ts.sys.readFile(file) ?? '').matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
        if (!spec.endsWith('.js')) bare.push(`${file}: ${spec}`)
        else visit(decodeURIComponent(new URL(spec.replace(/\.js$/, '.ts'), `file://${file}`).pathname))
      }
    }
    visit(decodeURIComponent(new URL('./index.ts', import.meta.url).pathname))
    expect(bare).toEqual([])
  })
})

describe('the rule list', () => {
  it('has a refused case for every rule', () => {
    const covered = new Set<RuleId>([...corpus.map((c) => c.rule), ...generated.map(([, , rule]) => rule)])
    expect(ruleIds.filter((r) => !covered.has(r))).toEqual([])
  })
})
