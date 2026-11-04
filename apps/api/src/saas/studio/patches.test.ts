import { describe, expect, it } from 'vitest'
import { applyEdits } from './patches'

const css = '@theme {\n  --color-ink: #222222;\n  --color-button: #1f6feb;\n}\n'
const home = "export const Home = () => <main className=\"p-6\"><h1>{t('home.title')}</h1></main>\n"
const theme = new Map([
  ['src/theme/styles/theme.css', css],
  ['src/theme/pages/Home.tsx', home],
  ['content/en/home.json', '{"title":"Hi","lead":"Hi"}\n'],
])

describe('applying the model’s edits', () => {
  it('turns a one-line colour change into the whole file the sandbox takes', () => {
    const applied = applyEdits(theme, [{ path: 'src/theme/styles/theme.css', edits: [{ search: '--color-button: #1f6feb;', replace: '--color-button: #800000;' }] }])
    expect(applied).toEqual({ ok: true, changes: [{ path: 'src/theme/styles/theme.css', content: css.replace('#1f6feb', '#800000') }], after: expect.any(Map) })
  })

  it('adds a new file whole, deletes a named one and applies a file’s edits in order', () => {
    const applied = applyEdits(theme, [
      { path: 'src/theme/components/Banner.tsx', content: 'export const Banner = () => null\n' },
      { path: 'src/theme/pages/Home.tsx', delete: true },
      { path: 'src/theme/styles/theme.css', edits: [{ search: '#222222', replace: '#111111' }, { search: '#111111;\n', replace: '#000000;\n' }] },
    ])
    expect(applied.ok && applied.changes).toEqual([
      { path: 'src/theme/components/Banner.tsx', content: 'export const Banner = () => null\n' },
      { path: 'src/theme/pages/Home.tsx', content: null },
      { path: 'src/theme/styles/theme.css', content: css.replace('#222222', '#000000') },
    ])
  })

  it('names a missing search text, a repeated one, an empty one and a file that isn’t there, all at once', () => {
    const applied = applyEdits(theme, [
      { path: 'src/theme/styles/theme.css', edits: [{ search: '--color-accent', replace: 'x' }] },
      { path: 'content/en/home.json', edits: [{ search: '"Hi"', replace: '"Hello"' }] },
      { path: 'src/theme/pages/Home.tsx', edits: [{ search: '', replace: 'x' }] },
      { path: 'src/theme/pages/About.tsx', edits: [{ search: 'a', replace: 'b' }] },
    ])
    expect(applied.ok).toBe(false)
    expect(applied.ok ? [] : applied.problems.map((p) => [p.file, p.rule])).toEqual([
      ['src/theme/styles/theme.css', 'patch/not-found'],
      ['content/en/home.json', 'patch/not-unique'],
      ['src/theme/pages/Home.tsx', 'patch/empty-search'],
      ['src/theme/pages/About.tsx', 'patch/missing-file'],
    ])
    expect(applied.ok ? '' : applied.problems[1]?.message).toMatch(/Edit 1 \(search "\\"Hi\\""\) appears 2 times \(lines 1, 1\)/)
  })

  it('sends nothing for an answer that leaves every file as it was', () => {
    const applied = applyEdits(theme, [{ path: 'src/theme/styles/theme.css', edits: [{ search: '#222222', replace: '#222222' }] }, { path: 'content/en/fr.json', delete: true }])
    expect(applied.ok && applied.changes).toEqual([])
  })
})
