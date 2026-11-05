import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { validateTheme, type GuardContext, type ThemeFile } from './index'

// What a theme may animate and how (storefront ARCHITECTURE §3.4; #1245), in CSS, Tailwind classes and motion.
vi.setConfig({ testTimeout: 30_000 })

const fixtures = decodeURIComponent(new URL('./fixtures/', import.meta.url).pathname)
const readTree = (dir: string): ThemeFile[] =>
  ts.sys.readDirectory(dir, undefined, undefined, ['**/*']).map((file) => ({ path: file.slice(dir.length + 1), content: ts.sys.readFile(file) ?? '' }))
const baseline = readTree(`${fixtures}baseline`)
const context: GuardContext = { locales: ['en', 'hi'], usedPaths: [], mediaIds: [], brand: { name: 'Northstar Linen', tagline: null, email: null, phone: null, address: [], socialLinks: [] } }

const island = (body: string, imports = 'animate, motion, useAnimate, useMotionValue, useScroll, useTransform'): ThemeFile => ({
  path: 'src/theme/components/interactive/Motion.tsx',
  content: [
    "'use client'",
    `import { ${imports} } from 'motion/react'`,
    "import { useRef } from 'react'",
    "import { useStorefront } from '@dripfunnel/storefront-core/theme'",
    'export const Motion = () => {',
    '  const { t } = useStorefront()',
    '  const own = useRef<HTMLDivElement>(null)',
    body,
    "  return <div ref={own}>{t('pages.home.title')}</div>",
    '}',
    '',
  ].join('\n'),
})
const css = (text: string): ThemeFile => ({ path: 'src/theme/styles/motion.module.css', content: text })
const note = (className: string): ThemeFile => ({
  path: 'src/theme/components/Note.tsx',
  content: `import { useStorefront } from '@dripfunnel/storefront-core/theme'\n\nexport const Note = () => {\n  const { t } = useStorefront()\n  return <p className="${className}">{t('pages.home.title')}</p>\n}\n`,
})
const reveal: ThemeFile = { path: 'src/theme/styles/theme.css', content: '@theme {\n  --animate-reveal: reveal linear both;\n}\n\n@keyframes reveal {\n  from {\n    clip-path: inset(0 0 100% 0);\n    background-color: #f4efe8;\n  }\n}\n' }

const problems = async (...files: ThemeFile[]) => (await validateTheme([...baseline, ...files], context)).problems
const at = (found: Awaited<ReturnType<typeof problems>>) => found.map((p) => ({ file: p.file, line: p.line, rule: p.rule }))

describe('what a theme may animate', () => {
  it('lets a scroll-driven reveal, paint, shadow, clip-path and mask through, in a CSS Module', async () => {
    const reel = '.a { animation: rise linear both; animation-timeline: view(); animation-range: entry 0% cover 50%; transition: background-color 0.2s, box-shadow 0.2s, clip-path 0.3s, text-shadow 0.2s, mask-size 0.3s; }\n@keyframes rise { to { clip-path: inset(0); mask-position: 0 0; stroke-dashoffset: 0; } }\n'
    expect(await problems(css(reel))).toEqual([])
  })

  it('lets the same through as Tailwind classes, theme.css keyframes included', async () => {
    expect(await problems(reveal, note('animate-reveal [animation-timeline:view()] [animation-range:entry_0%_cover_40%] transition-[background-color,box-shadow] hover:shadow-lg'))).toEqual([])
    expect(await problems(note('transition-[clip-path] [view-timeline:--hero_block]'))).toEqual([])
  })

  it.each([
    ['.a { transition: height 0.3s; }', 'height'],
    ['.a { transition: margin-top 0.3s, opacity 0.3s; }', 'margin-top'],
    ['@keyframes drop { from { top: -20px; } }', 'top'],
    ['.a { transition-property: padding, gap; transition-duration: 0.2s; }', 'padding, gap'],
  ])('refuses %s in a CSS Module, naming the layout property', async (text, named) => {
    const found = await problems(css(text))
    expect(at(found)).toEqual([{ file: 'src/theme/styles/motion.module.css', line: 1, rule: 'css/animated-property' }])
    expect(found[0]?.message).toContain(`not ${named}, which moves layout`)
  })

  it.each(['transition-[height]', 'transition-[margin]', '[transition:top_.3s]', 'transition-[inset]', 'transition-[font-size]'])('refuses the class %s, naming file and line', async (className) => {
    expect(at(await problems(note(className)))).toEqual([{ file: 'src/theme/components/Note.tsx', line: 5, rule: 'css/animated-property' }])
  })
})

describe('motion in a theme', () => {
  it('lets a parallax hero through: useScroll and useTransform on its own element', async () => {
    const hero = island("  const { scrollYProgress } = useScroll({ target: own })\n  const y = useTransform(scrollYProgress, [0, 1], ['0%', '25%'])\n  void (<motion.div style={{ y }} layout />)")
    expect(await problems(hero)).toEqual([])
  })

  it('lets animate and useAnimate act on its own element, a ref and a motion value', async () => {
    const own = island(
      [
        '  const x = useMotionValue(0)',
        '  const [scope, run] = useAnimate()',
        '  const press = () => {',
        '    void animate(x, 100)',
        "    if (own.current) void animate(own.current, { backgroundColor: '#1d1b18', boxShadow: 'none' })",
        "    void run(scope.current, { clipPath: 'inset(0)' })",
        '  }',
        '  void (<button ref={scope} type="button" onClick={press} />)',
      ].join('\n'),
    )
    expect(await problems(own)).toEqual([])
  })

  it.each([
    ["  void (<motion.div animate={{ height: 200 }} />)", 'jsx/animated-property'],
    ["  const top = useMotionValue(0)\n  void (<motion.div style={{ top }} />)", 'jsx/animated-property'],
    ['  const press = () => { if (own.current) void animate(own.current, { marginTop: 8 }) }\n  void press', 'jsx/animated-property'],
    ["  void animate('.card', { opacity: 0 })", 'code/animate-target'],
    ["  const [scope, run] = useAnimate()\n  void scope\n  void run('li', { opacity: 1 })", 'code/animate-target'],
    ['  const go = animate\n  void go', 'code/animate-target'],
    ['  const pair = useAnimate()\n  void pair', 'code/animate-target'],
    ["  void animate(JSON.parse('null'), { opacity: 0 })", 'code/animate-target'],
    ['  const press = () => { if (own.current) void animate([own.current], { opacity: 0 }) }\n  void press', 'code/animate-target'],
  ])('refuses %s with %s', async (body, rule) => {
    const found = await problems(island(body))
    expect(found.map((p) => p.rule)).toContain(rule)
    expect(found.every((p) => p.file === 'src/theme/components/interactive/Motion.tsx' && (p.line ?? 0) >= 8)).toBe(true)
  })

  it('names the layout property motion may not animate', async () => {
    const [found] = await problems(island('  void (<motion.div animate={{ height: 200 }} />)'))
    expect(found?.message).toContain('not height, which moves layout')
  })

  it('refuses motion outside components/interactive/, its scroll hook too', async () => {
    const fade: ThemeFile = { path: 'src/theme/components/Fade.tsx', content: "import { useScroll } from 'motion/react'\n\nexport const Fade = () => {\n  void useScroll()\n  return null\n}\n" }
    expect(at(await problems(fade))).toContainEqual({ file: 'src/theme/components/Fade.tsx', line: 1, rule: 'code/motion-outside-interactive' })
  })
})
