import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { themeStylesheet, validateChange, validateTheme, type GuardContext, type ThemeFile } from './index'

vi.setConfig({ testTimeout: 30_000 })

const fixtures = decodeURIComponent(new URL('./fixtures/', import.meta.url).pathname)
const readTree = (dir: string): ThemeFile[] =>
  ts.sys.readDirectory(dir, undefined, undefined, ['**/*']).map((file) => ({ path: file.slice(dir.length + 1), content: ts.sys.readFile(file) ?? '' }))
const baseline = readTree(`${fixtures}baseline`)
const tailwind = readTree(`${fixtures}allowed/tailwind-classes-and-tokens`)
const asMap = (files: readonly ThemeFile[]) => new Map(files.map((f) => [f.path, f.content]))

const context: GuardContext = { locales: ['en', 'hi'], usedPaths: [], mediaIds: ['m_hero01'], brand: { name: 'Northstar Linen', tagline: null, email: null, phone: null, address: [], socialLinks: [] } }

const card = (className: string): ThemeFile => ({
  path: 'src/theme/components/Note.tsx',
  content: `import { useStorefront } from '@dripfunnel/storefront-core/theme'\n\nexport const Note = () => {\n  const { t } = useStorefront()\n  return (\n    <p\n      className="${className}">{t('pages.home.title')}</p>\n  )\n}\n`,
})
const at = (result: { problems: { file: string | null; line: number | null; rule: string }[] }) => result.problems.map((p) => ({ file: p.file, line: p.line, rule: p.rule }))

describe('the class rules (ARCHITECTURE §3.4 "Classes")', () => {
  it.each([
    ['bg-[url(https://x)]', 'class/arbitrary-value'],
    ['bg-[url(m_hero01)]', 'class/arbitrary-value'],
    ["[background:url('//cdn.example/a.png')]", 'class/arbitrary-value'],
    ['[--x:@import]', 'class/arbitrary-value'],
    [String.raw`bg-[u\72l(x)]`, 'class/arbitrary-value'],
    ['[mask:javascript:x]', 'class/arbitrary-value'],
    ['w-(--tw-gradient-from)', 'class/arbitrary-value'],
    ['z-[100]', 'css/z-index'],
    ['in-focus:flex', 'css/selector-not-scoped'],
    ['**:hidden', 'css/selector-not-scoped'],
    ['[&~div]:hidden', 'css/selector-not-scoped'],
    ['has-[.df-price]:hidden', 'css/core-selector'],
    ['[&_#cart]:hidden', 'css/core-selector'],
    ['transition-all', 'css/animated-property'],
    ['transition-[width]', 'css/animated-property'],
    ["after:content-['Only_2_left']", 'css/text'],
    ['content-(--words)', 'css/text'],
    ['[&:visited]:underline', 'css/pseudo-not-allowed'],
    ['bg-[attr(data-x)]', 'css/function-not-allowed'],
    ['pretty-card', 'class/not-tailwind'],
  ])('refuses %s with %s, naming the file and line', async (className, rule) => {
    const result = await validateTheme([...baseline, card(className)], context)
    expect(at(result)).toContainEqual({ file: 'src/theme/components/Note.tsx', line: 7, rule })
  })

  it('lets known utilities, the theme’s tokens and checked arbitrary values through', async () => {
    const result = await validateTheme([...tailwind, ...baseline, card('flex gap-4 bg-ink text-paper p-[18px] md:grid hover:bg-ink/80 group-hover:opacity-80 peer-checked:block')], context)
    expect(result.problems).toEqual([])
  })

  it('refuses a theme token the theme never declared', async () => {
    expect(at(await validateTheme([...baseline, card('bg-ink')], context))).toEqual([{ file: 'src/theme/components/Note.tsx', line: 7, rule: 'class/not-tailwind' }])
  })

  it('reads several classes in a string as classes, not words, only where a class goes', async () => {
    const words = { path: 'src/theme/components/Words.tsx', content: "export const lead = 'flex gap-4 p-4'\n" }
    expect(at(await validateTheme([...baseline, words], context))).toEqual([{ file: 'src/theme/components/Words.tsx', line: 1, rule: 'code/text-in-string' }])
  })
})

describe('themeStylesheet: the CSS a bundle carries', () => {
  it('is null for a store on CSS Modules alone, so its bundle stays as it was', async () => {
    expect(validateChange(baseline, context).problems).toEqual([])
    expect((await validateTheme(baseline, context)).problems).toEqual([])
    expect(await themeStylesheet(asMap(baseline))).toEqual({ ok: true, css: null })
  })

  it('holds the classes the code writes and the tokens they use, with no reset and no address', async () => {
    const built = await themeStylesheet(asMap([...tailwind, ...baseline]))
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
    const css = built.css ?? ''
    expect(css).toContain('--color-ink: #1d1b18;')
    expect(css).toContain('.rounded-card {')
    expect(css).toContain('@keyframes rise')
    expect(css).not.toMatch(/https?:|\bhtml\b|\bbody\b/)
  })

  it('refuses to build a class the rules refuse', async () => {
    const built = await themeStylesheet(asMap([...baseline, card('z-[999]')]))
    expect(built.ok ? [] : built.problems.map((p) => p.rule)).toEqual(['css/z-index'])
  })
})
