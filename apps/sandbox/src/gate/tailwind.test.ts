import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isThemePath as coreThemePath } from '@dripfunnel/storefront-core/guard'
import { isThemePath } from '../paths'
import { overBudget, weigh } from './budgets'
import { bundle } from './bundle'

// Themes are styled with Tailwind v4, built by core's pinned compiler into the fast gate's bundle (#1239).
vi.setConfig({ testTimeout: 120_000 })

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const fixtures = `${repoRoot}packages/storefront-core/src/guard/fixtures/`
const dependencies = (file: string) => (JSON.parse(readFileSync(`${repoRoot}${file}`, 'utf8')) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> })
let root = ''

const cssOf = (out: string) =>
  readdirSync(join(out, 'assets'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(out, 'assets', f), 'utf8'))
    .join('')

const theme = (name: string, extra: readonly string[] = []) => {
  const repo = join(root, name)
  cpSync(`${fixtures}baseline`, repo, { recursive: true })
  for (const dir of extra) cpSync(dir, repo, { recursive: true })
  return repo
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'df-tailwind-'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('Tailwind in the fast gate’s bundle', () => {
  it('gives a store on CSS Modules alone no Tailwind stylesheet, only core’s reduced-motion rule (#1245)', async () => {
    const out = join(root, 'modules-out')
    const built = await bundle(theme('modules'), out)
    expect(built.ok, JSON.stringify(built.ok ? null : built.problems)).toBe(true)
    const css = cssOf(out)
    expect(css).not.toMatch(/@layer (?:theme|utilities)|--spacing/)
    expect(css).toMatch(/@layer df-reduced-motion\{@media \(prefers-reduced-motion:reduce\)/)
  })

  it('builds the classes a theme writes with its tokens, within the byte budgets', async () => {
    const out = join(root, 'tailwind-out')
    const built = await bundle(theme('tailwind', [`${fixtures}allowed/tailwind-classes-and-tokens`]), out)
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
    const css = cssOf(out)
    expect(css).toContain('--color-ink: #1d1b18')
    expect(css).toMatch(/\.rounded-card\{/)
    expect(css).not.toMatch(/tailwindcss\.com|\bbody\{/)
    expect(overBudget(await weigh(out, built.bundle))).toEqual([])
  })

  it('refuses to bundle a class the validator refuses, naming its file and line', async () => {
    const repo = theme('refused')
    writeFileSync(join(repo, 'src/theme/components/Bad.tsx'), 'export const Bad = () => <div className="bg-[url(https://cdn.example/a.png)]" />\n')
    const built = await bundle(repo, join(root, 'refused-out'))
    expect(built.ok ? [] : built.problems.map((p) => ({ file: p.file, line: p.line, rule: p.rule }))).toEqual([{ file: 'src/theme/components/Bad.tsx', line: 1, rule: 'class/arbitrary-value' }])
  })
})

describe('one Tailwind version', () => {
  it('is core’s, pinned exactly, and the store repo’s locked build brings none of its own', () => {
    expect(dependencies('packages/storefront-core/package.json').dependencies['tailwindcss']).toMatch(/^\d+\.\d+\.\d+$/)
    const template = dependencies('templates/storefront/package.json')
    expect(Object.keys({ ...template.dependencies, ...template.devDependencies }).filter((n) => n.includes('tailwind'))).toEqual([])
    expect(readFileSync(`${repoRoot}templates/storefront/postcss.config.mjs`, 'utf8')).toContain("'@dripfunnel/storefront-core/postcss'")
  })

  it('lets a theme write its theme.css wherever core’s guard does', () => {
    for (const path of ['src/theme/styles/theme.css', 'src/theme/styles/a/theme.css', 'src/theme/theme.css', 'src/theme/styles/home.module.css']) expect(isThemePath(path)).toBe(coreThemePath(path))
  })
})
