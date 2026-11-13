import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GuardContext } from '@dripfunnel/storefront-core/guard'
import { Workspace, type ChangeResult } from '../workspace'
import { build, validate } from './index'
import { laneOf } from './lanes'
import { chromiumPath } from '../browser'

// #1240: the warm checks and the lanes, on the baseline starting theme (Tailwind classes in clsx constants).
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const themeDir = decodeURIComponent(new URL('../../../../templates/storefront/themes/baseline/', import.meta.url).pathname)
const walk = async (dir: string, prefix = ''): Promise<{ path: string; content: string }[]> =>
  (
    await Promise.all(
      (await readdir(join(dir, prefix))).map(async (name) => {
        const rel = prefix ? `${prefix}/${name}` : name
        return (await stat(join(dir, rel))).isDirectory() ? walk(dir, rel) : [{ path: rel, content: await readFile(join(dir, rel), 'utf8') }]
      }),
    )
  ).flat()

const context: GuardContext = { locales: ['en'], usedPaths: [], mediaIds: [], brand: { name: 'Northstar Linen', tagline: null, email: null, phone: null, address: [], socialLinks: [] } }

const home = 'src/theme/pages/HomePage.tsx'
const homeStyles = 'src/theme/components/styles/home.tsx'
const themeCss = 'src/theme/styles/theme.css'

let root: string
let files: { path: string; content: string }[]
const original = (path: string) => files.find((f) => f.path === path)?.content ?? ''
const edit = (path: string, from: string, to: string) => {
  const was = original(path)
  if (!was.includes(from)) throw new Error(`${path} has no ${from}`)
  return { path, content: was.replace(from, to) }
}
const theme = () => new Map(files.filter((f) => f.path !== 'package.json').map((f) => [f.path, f.content]))

const loaded = async (name: string) => {
  const ws = new Workspace(join(root, name))
  await ws.loadFiles(files, 'Start from the baseline template')
  return ws
}
const passed = (r: ChangeResult) => {
  if (!r.ok) throw new Error(JSON.stringify(r.problems))
  return r
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'warm-gate-'))
  files = [...(await walk(themeDir)).filter((f) => f.path !== 'template.json'), { path: 'package.json', content: '{ "name": "store" }\n' }]
})
afterAll(() => rm(root, { recursive: true, force: true }))

describe('the lanes, chosen from the diff', () => {
  it('names a change of CSS files alone the CSS lane', () => {
    expect(laneOf(theme(), [edit(themeCss, '#2f5d50', '#7a1f2b')])).toBe('css')
    expect(laneOf(theme(), [{ path: 'src/theme/styles/extra.module.css', content: '.box { color: red; }\n' }])).toBe('css')
  })

  it('names edits to clsx strings and an element’s className the class lane, with CSS beside them', () => {
    expect(laneOf(theme(), [edit(homeStyles, 'bg-accent text-accent-ink', 'bg-ink text-bg'), edit(themeCss, '#2f5d50', '#7a1f2b')])).toBe('class')
    const page = { path: 'src/theme/pages/Demo.tsx', content: "import { clsx } from 'clsx'\nexport const Demo = ({ on }: { on: boolean }) => <div className={clsx('p-4', on && 'bg-ink')}><p className=\"m-0\" /></div>\n" }
    const before = new Map([[page.path, page.content]])
    expect(laneOf(before, [{ path: page.path, content: page.content.replace("'bg-ink'", "'bg-accent'").replace('"m-0"', '"m-2"') }])).toBe('class')
  })

  it('sends anything else to the full gate: code, a component’s className, a condition, words, routes', () => {
    expect(laneOf(theme(), [edit(home, '<section className={styles.hero}>', '<section className={styles.hero} id="top">')])).toBe('full')
    const page = { path: 'src/theme/pages/Demo.tsx', content: "import { clsx } from 'clsx'\nimport { Link } from '@dripfunnel/storefront-core/theme'\nexport const Demo = ({ v }: { v: 'a' | 'b' }) => <Link href=\"/\" className=\"p-4\">{clsx(v === 'a' && 'p-2')}</Link>\n" }
    const before = new Map([[page.path, page.content]])
    expect(laneOf(before, [{ path: page.path, content: page.content.replace('"p-4"', '"p-6"') }])).toBe('full')
    expect(laneOf(before, [{ path: page.path, content: page.content.replace("v === 'a'", "v === 'c'") }])).toBe('full')
    expect(laneOf(theme(), [edit('content/en/home.json', '"hero"', '"hero"'), edit(homeStyles, 'bg-accent', 'bg-ink')])).toBe('full')
    expect(laneOf(theme(), [])).toBe('full')
  })
})

describe('the warm gate in a slot', () => {
  it('rechecks only the touched file on a second change, and a newly loaded draft starts with fresh services', async () => {
    const ws = await loaded('reuse')
    await ws.prime()
    const first = passed(await ws.change([edit(home, '<section className={styles.hero}>', '<section className={styles.hero} id="top">')], 'One', context))
    expect(first.lane).toBe('full')
    expect(first.typechecked).toEqual([home])
    await ws.loadFiles(files, 'Start again')
    const fresh = passed(await ws.change([edit(home, '<section className={styles.hero}>', '<section className={styles.hero} id="top">')], 'One again', context))
    expect(fresh.typechecked?.length).toBeGreaterThan(20)
  })

  it('bundles lucide-react icons into the theme, only those it uses', async () => {
    const ws = await loaded('icons')
    const perks = (body: string, imports: string) => ({ path: 'src/theme/components/Perks.tsx', content: `${imports}export const Perks = () => <p className="flex gap-2">${body}</p>\n` })
    const used = edit(home, '<section className={styles.hero}>', '<section className={styles.hero}>\n        <Perks />')
    const page = { ...used, content: `import { Perks } from '../components/Perks'\n${used.content}` }
    const jsBytes = (r: ChangeResult) => (r.ok ? r.bundle.files.filter((f) => f.path.endsWith('.js')).reduce((n, f) => n + f.bytes, 0) : 0)
    const plain = jsBytes(passed(await ws.change([perks('Free delivery', ''), page], 'Plain', context)))
    const icons = jsBytes(passed(await ws.change([perks('<Truck aria-hidden /> <ShieldCheck aria-hidden /> Free delivery', "import { ShieldCheck, Truck } from 'lucide-react'\n\n")], 'Icons', context)))
    expect(icons - plain).toBeGreaterThan(0)
    expect(icons - plain).toBeLessThan(20 * 1024)
  })

  it('refuses a full-lane change whose page throws while rendering, naming the page and the error', async () => {
    const ws = await loaded('render')
    const thrown = await ws.change([edit(home, '<section className={styles.hero}>', '<section className={styles.hero}>{([] as number[]).reduce((a, b) => a + b)}')], 'Sum', context)
    expect(thrown.ok).toBe(false)
    expect(!thrown.ok && thrown.problems).toEqual([expect.objectContaining({ step: 'render', rule: 'render/throws', message: expect.stringMatching(/^The home page threw while rendering: .*empty array/) })])
  })

  it('renders each change afresh: a throwing page refused, then its fix passes, then a new throw is refused', async () => {
    const ws = await loaded('render-twice')
    const throwing = edit(home, '<section className={styles.hero}>', '<section className={styles.hero}>{([] as number[]).reduce((a, b) => a + b)}')
    expect((await ws.change([throwing], 'Sum', context)).ok).toBe(false)
    passed(await ws.change([edit(home, '<section className={styles.hero}>', '<section className={styles.hero} id="top">')], 'Anchor', context))
    expect((await ws.change([{ path: home, content: throwing.content.replace('<section className={styles.hero} id="top">', '<section className={styles.hero}>') }], 'Sum again', context)).ok).toBe(false)
  })

  it.skipIf(chromiumPath() === null)('pictures a page with a working copy from a scratch copy, leaving the draft as it was', async () => {
    const ws = await loaded('picture')
    const before = await ws.theme()
    const maroon = edit(themeCss, '#2f5d50', '#7a1f2b')
    const shot = await ws.picture([maroon], 'home', 'desktop', context)
    expect(shot.problem).toBeNull()
    expect(shot.images.length).toBeGreaterThan(0)
    expect(Buffer.from(shot.images[0] ?? '', 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    expect(await ws.theme()).toEqual(before)
    expect((await ws.picture([], 'nowhere', 'desktop', context)).problem).toContain('no page')
    const thrown = await ws.picture([edit(home, '<section className={styles.hero}>', '<section className={styles.hero}>{([] as number[]).reduce((a, b) => a + b)}')], 'home', 'phone', context)
    expect(thrown).toMatchObject({ images: [], problem: expect.stringContaining('threw while rendering') })
    expect((await ws.picture([{ path: '../outside.txt', content: 'x' }], 'home', 'desktop', context)).problem).toContain('outside the theme')
    const unchecked = { path: 'src/theme/components/Leak.tsx', content: "export const Leak = () => { void fetch('https://example.com'); return null }\n" }
    expect(await ws.picture([unchecked], 'home', 'desktop', context)).toEqual({ images: [], problem: 'Call check and fix what it names first.' })
  })

  it('shows passing work in the frame without committing it, and the head again on no files, refusing what the validator refuses', async () => {
    const ws = new Workspace(join(root, 'show'))
    const first = await ws.loadFiles(files, 'Start from the baseline template')
    const before = await ws.theme()
    const shown = await ws.show([edit(themeCss, '#2f5d50', '#7a1f2b')], context)
    expect(shown).toMatchObject({ ok: true, swap: 'stylesheet' })
    expect(shown.ok && shown.bundle.id).not.toBe(first.bundle?.id)
    expect(await ws.head()).toBe(first.head)
    expect(await ws.theme()).toEqual(before)
    const leak = { path: 'src/theme/components/Leak.tsx', content: "export const Leak = () => { void fetch('https://example.com'); return null }\n" }
    expect(await ws.show([leak], context)).toEqual({ ok: false })
    expect(await ws.show([{ path: '../outside.txt', content: 'x' }], context)).toEqual({ ok: false })
    const back = await ws.show([], context)
    expect(back.ok && back.bundle.id).toBe(first.bundle?.id)
  })

  it('takes a CSS-only change without the typecheck, swapping only the stylesheet, and still refuses a forbidden function or file', async () => {
    const ws = await loaded('css')
    const before = ws.bundleNow()
    const made = passed(await ws.change([edit(themeCss, '#2f5d50', '#7a1f2b')], 'Maroon', context))
    expect(made.lane).toBe('css')
    expect(made.typechecked).toBeNull()
    expect(made.swap).toBe('stylesheet')
    expect(made.bundle.entry).toBe(before?.entry)
    expect(made.bundle.files.filter((f) => f.path.endsWith('.css'))).not.toEqual(before?.files.filter((f) => f.path.endsWith('.css')))

    const fn = await ws.change([edit(themeCss, '--color-bg: #fbf8f4;', '--color-bg: paint(waves);')], 'Waves', context)
    expect(fn.ok).toBe(false)
    expect(!fn.ok && fn.problems.map((p) => p.rule)).toContain('css/function-not-allowed')
    const file = await ws.change([{ path: 'public/extra.css', content: 'body { color: red; }\n' }], 'Extra', context)
    expect(file.ok).toBe(false)
    expect(!file.ok && file.problems[0]?.step).toBe('validator')
  })

  it('takes a class-only change without the typecheck and still refuses an arbitrary value the rules refuse', async () => {
    const ws = await loaded('class')
    const made = passed(await ws.change([edit(homeStyles, 'bg-accent text-accent-ink', 'bg-ink text-bg')], 'Dark buttons', context))
    expect(made.lane).toBe('class')
    expect(made.typechecked).toBeNull()
    expect(made.swap).toBe('modules')
    const refused = await ws.change([edit(homeStyles, 'bg-accent text-accent-ink', 'bg-[url(https://example.com/a.png)] text-accent-ink')], 'A picture', context)
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.problems.every((p) => p.step === 'validator')).toBe(true)
  })

  it('takes the full gate for a TSX change beyond class strings, and it refuses a type error', async () => {
    const ws = await loaded('full')
    const broken = await ws.change([edit(home, 'export const HomePage = () => {', 'const wrong: number = "x"\nexport const HomePage = () => {')], 'Broken', context)
    expect(broken.ok).toBe(false)
    expect(!broken.ok && broken.problems.map((p) => [p.step, p.file])).toEqual([['typecheck', home]])
  })

  it('gives the same answer as the gate from cold on the same files, passing and failing', async () => {
    const ws = await loaded('same')
    const out = join(root, 'cold-out')
    const change = [edit(home, '<section className={styles.hero}>', '<section className={styles.hero} id="top">')]
    const warm = passed(await ws.change(change, 'Warm', context))
    const after = new Map([...theme(), ...change.map((f) => [f.path, f.content] as const)])
    expect(await validate([...after].map(([path, content]) => ({ path, content })), context)).toEqual([])
    const cold = await build(after, join(root, 'same', 'repo'), out)
    expect(cold.ok && cold.bundle).toEqual(warm.bundle)

    const wrong = [edit(home, 'export const HomePage = () => {', 'const wrong: number = "x"\nexport const HomePage = () => {')]
    const failed = await ws.change(wrong, 'Wrong', context)
    const coldFailed = await build(new Map([...theme(), ...wrong.map((f) => [f.path, f.content] as const)]), join(root, 'same', 'repo'), out)
    expect(failed).toEqual(coldFailed)
  })

  it('pre-checks the change so far without writing it, naming the validator’s and the typecheck’s problems together', async () => {
    const ws = await loaded('pre')
    const head = await ws.head()
    const so = await ws.precheck([edit(home, 'export const HomePage = () => {', 'const wrong: number = "x"\nexport const HomePage = () => {'), { path: 'src/theme/styles/bad.module.css', content: 'body { color: red; }\n' }], context)
    expect(so.lane).toBe('full')
    expect(so.problems.map((p) => p.step)).toEqual(expect.arrayContaining(['validator', 'typecheck']))
    expect(await ws.head()).toBe(head)
    expect((await ws.theme()).has('src/theme/styles/bad.module.css')).toBe(false)
  })
})
