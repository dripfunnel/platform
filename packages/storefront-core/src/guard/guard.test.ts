import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { base64, jpeg, png, webp } from '../../test/images'
import { maxFileBytes, maxFiles, maxMediaBytes, maxMediaFiles, maxMediaTotalBytes, maxThemeBytes, ruleIds, validateChange, validateTheme, type GuardContext, type Problem, type RuleId, type ThemeFile } from './index'

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
  mediaIds: ['m_hero01'],
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

describe('validateTheme: the baseline theme', () => {
  it('passes with no problem', async () => {
    expect(validateChange(baseline, context)).toEqual({ ok: true, problems: [] })
    expect(await validateTheme(baseline, context)).toEqual({ ok: true, problems: [] })
  })
})

describe('validateTheme: the refused corpus, one case per rule (fixtures/refused)', () => {
  it.each(corpus)('$name is refused whole, by $rule at $file:$line', async ({ files, remove, rule, file, line, also = [] }) => {
    const result = await validateTheme(changed(files, remove), context)
    expect(result.ok).toBe(false)
    expect(result.problems.map(at)).toContainEqual({ file, line, rule })
    expect(new Set(result.problems.map((p) => p.rule))).toEqual(new Set([rule, ...also]))
    for (const p of result.problems) expect(p.message.length).toBeGreaterThan(20)
  })
})

const accepted = ts.sys.getDirectories(`${fixtures}allowed`).map((name) => ({ name, files: readTree(`${fixtures}allowed/${name}`) }))

describe('validateTheme: the accepted corpus, honest code each rule must let through (fixtures/allowed)', () => {
  it.each(accepted)('$name passes', async ({ files }) => {
    expect((await validateTheme(changed(files), context)).problems).toEqual([])
  })
})

const page = (path: string, content = 'export const X = () => null\n'): ThemeFile => ({ path, content })
const padded = (path: string, bytes: number): ThemeFile => page(path, `//${'x'.repeat(bytes - 2)}`)
const image = (name: string, bytes: Uint8Array = webp()): ThemeFile => ({ path: `src/theme/media/${name}`, content: base64(bytes), encoding: 'base64' })
// A PNG of `bytes` bytes: its IDAT holds the padding, which the structural read never decodes. Built once per size.
const sized = new Map<number, Uint8Array>()
const pngOf = (bytes: number): Uint8Array => {
  const built = sized.get(bytes) ?? png(4, 3, new Array<number>(bytes - png(4, 3, []).length).fill(0))
  sized.set(bytes, built)
  return built
}
const styled = (css: string): ThemeFile => page('src/theme/styles/Banner.module.css', css)

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
  ['an image sent as text', [{ path: 'src/theme/media/hero.webp', content: 'RIFF' }], 'files/encoding', 'src/theme/media/hero.webp'],
  ['a text file sent as base64', [{ ...page('src/theme/pages/Extra.tsx'), encoding: 'base64' }], 'files/encoding', 'src/theme/pages/Extra.tsx'],
  ['an SVG in media/', [image('logo.svg')], 'files/media-type-not-allowed', 'src/theme/media/logo.svg'],
  ['a video in media/', [image('intro.mp4')], 'files/media-type-not-allowed', 'src/theme/media/intro.mp4'],
  ['an image in a media/ subfolder', [image('home/hero.webp')], 'files/media-type-not-allowed', 'src/theme/media/home/hero.webp'],
  ['an image name with a space', [image('haldi home.webp')], 'files/media-name-not-allowed', 'src/theme/media/haldi home.webp'],
  ['an image name with an upper-case extension', [image('hero.WEBP')], 'files/media-name-not-allowed', 'src/theme/media/hero.WEBP'],
  ['a .png that is a JPEG', [image('hero.png', jpeg())], 'files/media-type-mismatch', 'src/theme/media/hero.png'],
  ['a .webp that is text', [image('hero.webp', new TextEncoder().encode('<svg/>'))], 'files/media-type-mismatch', 'src/theme/media/hero.webp'],
  ['an image cut short', [image('hero.png', png().subarray(0, 40))], 'files/media-unreadable', 'src/theme/media/hero.png'],
  ['an image over 10,000 pixels wide', [image('hero.png', png(10_001, 1))], 'files/media-dimensions', 'src/theme/media/hero.png'],
  ['an image over its cap', [image('hero.png', pngOf(maxMediaBytes + 1))], 'files/media-too-large', 'src/theme/media/hero.png'],
  ['too many images', Array.from({ length: maxMediaFiles + 1 }, (_, i) => image(`i${i}.webp`)), 'files/too-many-media', null],
  ['images over their total cap', Array.from({ length: maxMediaTotalBytes / maxMediaBytes + 1 }, (_, i) => image(`i${i}.png`, pngOf(maxMediaBytes))), 'files/media-total-too-large', null],
  ['a CSS url() naming no image in media/', [styled('.banner { background-image: url(media/missing.webp); }\n')], 'css/media-not-found', 'src/theme/styles/Banner.module.css'],
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

describe('validateChange: a theme\'s own images (#1405)', () => {
  it('accepts PNG, JPEG and WebP images that CSS names as media/<name>', () => {
    const css = styled('.banner { background-image: url(media/haldi-home.webp); }\n.logo { background: url(media/logo.png); }\n.hero { background: url(m_hero01); }\n')
    const files = [image('haldi-home.webp'), image('logo.png', png()), image('photo.jpg', jpeg()), image('photo_2.jpeg', jpeg()), css]
    expect(validateChange(changed(files), context)).toEqual({ ok: true, problems: [] })
  })

  it('accepts an image exactly at its cap, and the most images exactly at the total cap', () => {
    expect(validateChange(changed([image('hero.png', pngOf(maxMediaBytes))]), context).ok).toBe(true)
    const full = Array.from({ length: maxMediaTotalBytes / maxMediaBytes }, (_, i) => image(`i${i}.png`, pngOf(maxMediaBytes)))
    expect(validateChange(changed(full), context).ok).toBe(true)
    expect(validateChange(changed(Array.from({ length: maxMediaFiles }, (_, i) => image(`i${i}.webp`))), context).ok).toBe(true)
  })

  it('leaves the code caps to code: images count toward neither the file count nor the theme size', () => {
    const code = Array.from({ length: maxFiles - baseline.length }, (_, i) => page(`src/theme/components/C${i}.tsx`))
    expect(validateChange(changed([...code, image('hero.png', pngOf(maxMediaBytes))]), context).ok).toBe(true)
  })

  it('accepts <ThemeImage src> naming an image in media/, and a choice of two that are both there', () => {
    const banner = page(
      'src/theme/components/Banner.tsx',
      "import { ThemeImage, useStorefront } from '@dripfunnel/storefront-core/theme'\n\nexport const Banner = ({ warm }: { warm: boolean }) => {\n  const { t } = useStorefront()\n  return (\n    <div>\n      <ThemeImage src=\"haldi-home.webp\" alt={t('pages.home.title')} ratio={1.5} />\n      <ThemeImage src={warm ? 'haldi-home.webp' : 'logo.png'} alt={t('pages.home.title')} ratio={1} />\n    </div>\n  )\n}\n",
    )
    expect(validateChange(changed([banner, image('haldi-home.webp'), image('logo.png', png())]), context)).toEqual({ ok: true, problems: [] })
    expect(validateChange(changed([banner, image('haldi-home.webp')]), context).problems.map(at)).toEqual([{ file: 'src/theme/components/Banner.tsx', line: 8, rule: 'jsx/theme-image-not-found' }])
  })

  it('checks ThemeImage renamed on import or reached through a namespace, and leaves a theme’s own ThemeImage alone', () => {
    const using = (name: string, head: string, tag: string) =>
      page(`src/theme/components/${name}.tsx`, `${head}\n\nexport const ${name} = () => {\n  const { t } = core.useStorefront()\n  return <${tag} src="missing.webp" alt={t('pages.home.title')} ratio={1} />\n}\n`)
    const renamed = using('Renamed', "import * as core from '@dripfunnel/storefront-core/theme'\nimport { ThemeImage as Picture } from '@dripfunnel/storefront-core/theme'", 'Picture')
    const spaced = using('Spaced', "import * as core from '@dripfunnel/storefront-core/theme'", 'core.ThemeImage')
    const own = using('Own', "import * as core from '@dripfunnel/storefront-core/theme'\n\nconst ThemeImage = (p: { src: 'missing.webp'; alt: string; ratio: number }) => <div title={p.alt} />", 'ThemeImage')
    expect(validateChange(changed([renamed, spaced, own]), context).problems.map(at)).toEqual([
      { file: 'src/theme/components/Renamed.tsx', line: 6, rule: 'jsx/theme-image-not-found' },
      { file: 'src/theme/components/Spaced.tsx', line: 5, rule: 'jsx/theme-image-not-found' },
    ])
  })

  it('folds an image name with another that differs only in case', () => {
    const result = validateChange(changed([image('hero.webp'), image('Hero.webp')]), context)
    expect(result.problems.map((p) => p.rule)).toEqual(['files/duplicate-path'])
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

  it('lets a theme leave the optional routes out, and checks the page of each it maps (#324, #1214)', () => {
    const parsed = JSON.parse(baseline.find((f) => f.path === 'routes.json')?.content ?? '{}') as { routes: Record<string, string> }
    const mapped = (extra: Record<string, string>) => ({ path: 'routes.json', content: JSON.stringify({ ...parsed, routes: { ...parsed.routes, ...extra } }, null, 2) })
    expect(validateChange(baseline, context).ok).toBe(true)
    expect(validateChange(changed([mapped({ contentPage: 'AboutPage', blog: 'HomePage', blogPost: 'HomePage', accountWishlist: 'HomePage' })]), context).ok).toBe(true)
    expect(validateChange(changed([mapped({ accountWishlist: 'account/WishlistPage' })]), context).problems.map((p) => p.rule)).toEqual(['routes/page-not-found'])
    expect(validateChange(changed([mapped({ blogPost: 'content/PostPage' })]), context).problems.map((p) => p.rule)).toEqual(['routes/page-not-found'])
    expect(validateChange(changed([mapped({ blogs: 'HomePage' })]), context).problems.map((p) => p.rule)).toEqual(['routes/invalid'])
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

describe('validateChange: messages that point the author at the fix', () => {
  it('sends a style attribute on an element to the CSS Modules', () => {
    const style = readTree(`${fixtures}refused/jsx-attribute-not-allowed-style`)
    const found = validateChange(changed(style), context).problems.find((p) => p.rule === 'jsx/attribute-not-allowed')
    expect(found?.message).toContain('CSS Modules')
  })
})
