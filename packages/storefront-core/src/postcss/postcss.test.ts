import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { storefrontTailwind, tailwindEntry } from './index'

const repos: string[] = []
afterEach(() => {
  for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true })
})

const repoWith = (page: string) => {
  const root = mkdtempSync(join(tmpdir(), 'df-postcss-'))
  repos.push(root)
  mkdirSync(join(root, 'src/theme/pages'), { recursive: true })
  mkdirSync(join(root, 'src/theme/styles'), { recursive: true })
  writeFileSync(join(root, 'src/theme/pages/HomePage.tsx'), page)
  writeFileSync(join(root, 'src/theme/styles/theme.css'), '@theme {\n  --color-ink: #1d1b18;\n}\n')
  writeFileSync(join(root, 'src/theme/styles/home.module.css'), '/* bg-[url(https://evil.example/m.png)] */\n.a {\n  color: red;\n}\n')
  return root
}

/** Runs the plugin over the file at `rel`, as PostCSS would: what it left in the stylesheet, or what it threw. */
const run = async (root: string, rel: string) => {
  const appended: string[] = []
  let removed = false
  const css = { source: { input: { file: join(root, rel) } }, removeAll: () => (removed = true), append: (node: unknown) => appended.push(String(node)) }
  await storefrontTailwind({ root }).Once(css, { result: { messages: [] }, postcss: { parse: (text: string) => text } })
  return { removed, css: appended.join('') }
}

describe('core’s PostCSS plugin, the store repo’s locked build', () => {
  it('builds only the classes the validator judged: a class in a comment or a CSS Module never reaches the CSS', async () => {
    const root = repoWith('// bg-[url(https://evil.example/x.png)]\nexport const HomePage = () => <main className="p-6 bg-ink" />\n')
    const { removed, css } = await run(root, tailwindEntry)
    expect(removed).toBe(true)
    expect(css).toContain('.p-6 {')
    expect(css).toContain('--color-ink: #1d1b18;')
    expect(css).not.toMatch(/url\(|evil/)
  })

  it('fails the build naming the file, line and rule of a class the rules refuse', async () => {
    const root = repoWith('export const HomePage = () => (\n  <main className="z-[999]" />\n)\n')
    await expect(run(root, tailwindEntry)).rejects.toThrow('src/theme/pages/HomePage.tsx:2  css/z-index')
  })

  it('leaves every other stylesheet as it is', async () => {
    const root = repoWith('export const HomePage = () => <main className="p-6" />\n')
    expect(await run(root, 'src/theme/styles/home.module.css')).toEqual({ removed: false, css: '' })
  })
})
