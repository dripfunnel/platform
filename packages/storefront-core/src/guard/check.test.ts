/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jpeg, png } from '../../test/images'
import { runCheck } from './check'
import { fileNear } from './program'
import type { GuardContext, ThemeFile } from './rules'
import { validateChange, validateLocally } from './validate'

// A store repo's `pnpm check` (#974): the validator over what a push would carry, on a developer's machine.

// The first run builds the TypeScript program with the DOM's types, which takes over 10 s on CI's runners.
vi.setConfig({ testTimeout: 30_000 })

const baseline = fileURLToPath(new URL('./fixtures/baseline/', import.meta.url))
const repos: string[] = []
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })

/** A store repo holding the baseline theme, every file added to git, then `edit` applied on disk. */
const repoWith = (edit: (root: string) => void = () => undefined) => {
  const root = mkdtempSync(join(tmpdir(), 'df-check-'))
  repos.push(root)
  cpSync(baseline, root, { recursive: true })
  git(root, 'init', '-q')
  git(root, 'add', '-A')
  edit(root)
  return root
}
const rewrite = (root: string, path: string, change: (text: string) => string) => writeFileSync(join(root, path), change(readFileSync(join(root, path), 'utf8')))

afterEach(() => {
  for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('pnpm check', () => {
  it('passes the baseline theme and names what only the build checks', async () => {
    const { code, lines } = await runCheck(repoWith())
    expect(code).toBe(0)
    expect(lines[0]).toBe('The theme passes the validator.')
    expect(lines.at(-1)).toMatch(/^Checked when you push, not here: that the content\/ folders are exactly the store's languages; /)
  })

  it('reads an image on disk as its bytes, and refuses one whose bytes are another type (#1405)', async () => {
    const withImage = (bytes: Uint8Array) =>
      repoWith((r) => {
        mkdirSync(join(r, 'src/theme/media'), { recursive: true })
        writeFileSync(join(r, 'src/theme/media/haldi-home.png'), bytes)
        git(r, 'add', '-A')
      })
    expect((await runCheck(withImage(png(640, 480)))).code).toBe(0)
    const { code, lines } = await runCheck(withImage(jpeg()))
    expect(code).toBe(1)
    expect(lines[0]).toMatch(/^src\/theme\/media\/haldi-home\.png {2}files\/media-type-mismatch {2}/)
  })

  it('refuses an invented claim typed in JSX, naming the file, line and rule', async () => {
    const root = repoWith((r) => rewrite(r, 'src/theme/pages/HomePage.tsx', (text) => text.replace("{t('pages.home.lead')}", 'Only 3 left in stock')))
    const { code, lines } = await runCheck(root)
    expect(code).toBe(1)
    expect(lines[0]).toMatch(/^src\/theme\/pages\/HomePage\.tsx:10 {2}content\/scarcity {2}/)
    expect(lines).toContain('1 problem(s): the build would refuse this push.')
  })

  it('refuses an invented discount in the words', async () => {
    const root = repoWith((r) => rewrite(r, 'content/en/common.json', (text) => text.replace('Thank you for shopping with a small studio.', 'Up to 60% off this week.')))
    const { code, lines } = await runCheck(root)
    expect(code).toBe(1)
    expect(lines.some((l) => l.startsWith('content/en/common.json:') && l.includes('content/price'))).toBe(true)
  })

  it('checks what a push carries: a theme file never added to git is named, not checked', async () => {
    const root = repoWith((r) => writeFileSync(join(r, 'src/theme/components/Banner.tsx'), 'export const Banner = () => <p>Not added</p>\n'))
    const { code, lines } = await runCheck(root)
    expect(code).toBe(0)
    expect(lines).toContain("src/theme/components/Banner.tsx  not added to git: a push leaves it out, so the build won't see it")
  })

  it('checks a theme folder named like a build folder, such as out/', async () => {
    const root = repoWith((r) => {
      mkdirSync(join(r, 'src/theme/components/out'))
      writeFileSync(join(r, 'src/theme/components/out/Note.tsx'), 'export const Note = () => <p>Only 3 left in stock</p>\n')
      git(r, 'add', '-A')
    })
    const { code, lines } = await runCheck(root)
    expect(code).toBe(1)
    expect(lines[0]).toMatch(/^src\/theme\/components\/out\/Note\.tsx:1 {2}content\/scarcity/)
  })

  it('names a file whose copy on disk is not the staged one, since a commit would carry the staged one', async () => {
    const page = 'src/theme/pages/HomePage.tsx'
    const root = repoWith((r) => {
      rewrite(r, page, (text) => text.replace("{t('pages.home.lead')}", 'Typed words'))
      git(r, 'add', '-A')
      rewrite(r, page, (text) => text.replace('Typed words', "{t('pages.home.lead')}"))
    })
    const { code, lines } = await runCheck(root)
    expect(code).toBe(0)
    expect(lines).toContain(`${page}  changed since git add: checked as it is here, so git add it before you commit`)
  })

  it('says where to run it from outside a store repo, and what is missing without words', async () => {
    expect(await runCheck(repoWith((r) => rmSync(join(r, '.git'), { recursive: true, force: true })))).toEqual({ code: 1, lines: ["Run pnpm check from the store repo's root, where its .git folder is."] })
    expect(await runCheck(repoWith((r) => rmSync(join(r, 'content'), { recursive: true, force: true })))).toEqual({
      code: 1,
      lines: ['The theme has no words: content/{language}/*.json holds them, one folder per language the store offers.'],
    })
  })
})

describe('validateLocally: what it leaves to the build', () => {
  const read = (path: string): ThemeFile => ({ path, content: readFileSync(join(baseline, path), 'utf8') })
  const files = execFileSync('git', ['ls-files', '-z', '--', '.'], { cwd: baseline, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map(read)
  const store: GuardContext = { locales: ['en', 'hi'], usedPaths: ['/our-story'], mediaIds: [], brand: { name: 'Northstar Linen', tagline: null, email: null, phone: null, address: [], socialLinks: [] } }
  const swap = (path: string, change: (text: string) => string) => files.map((f) => (f.path === path ? { ...f, content: change(f.content) } : f))
  const rules = (result: { problems: { rule: string }[] }) => result.problems.map((p) => p.rule)

  it('skips the brand, the media ids and the used paths, which the build still refuses', async () => {
    const copied = swap('content/en/common.json', (text) => text.replace('Thank you for shopping with a small studio.', 'Thank you for shopping at Northstar Linen.'))
    const pictured = swap('src/theme/styles/page.module.css', (text) => `${text}\n.hero { background-image: url(m_unknown); }\n`)
    for (const [change, rule] of [
      [copied, 'content/brand-literal'],
      [pictured, 'css/url-not-media'],
      [files, 'routes/path-in-use'],
    ] as const) {
      expect(rules(validateChange(change, store))).toContain(rule)
      expect(rules(await validateLocally(change, ['en', 'hi']))).not.toContain(rule)
    }
  })

  it('still refuses a url() that is no media id at all', async () => {
    const address = swap('src/theme/styles/page.module.css', (text) => `${text}\n.hero { background-image: url(https://example.com/a.png); }\n`)
    expect(rules(await validateLocally(address, ['en', 'hi']))).toEqual(['css/url-not-media'])
  })
})

describe('the validator on any system', () => {
  it('names a Windows file as a drive path, never /D:/', () => {
    expect(fileNear('../theme/index.d.ts', 'file:///D:/store/node_modules/core/dist/guard/program.js', true)).toBe('D:/store/node_modules/core/dist/theme/index.d.ts')
    expect(fileNear('../theme/index.d.ts', 'file:///srv/core/dist/guard/program.js', false)).toBe('/srv/core/dist/theme/index.d.ts')
  })

  it('finds its own files here', () => {
    expect(existsSync(fileNear('./program.ts', import.meta.url))).toBe(true)
  })
})
