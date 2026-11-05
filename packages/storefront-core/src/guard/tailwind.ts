/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { compile, __unstable__loadDesignSystem } from 'tailwindcss'
import ts from 'typescript'
import { checkClassCss, checkCss } from './css.js'
import { codePath, isThemePath, themeCssPath } from './files.js'
import { problem, type GuardContext, type Problem, type RuleId } from './rules.js'

// Themes are styled with Tailwind v4 classes, each checked against ARCHITECTURE §3.4 "Classes" (#1239). Core pins one
// Tailwind version, so the validator, the sandbox's bundle and a store repo's build read classes the same way.

const sheets = new Map<string, string>()
const require = createRequire(import.meta.url)
// Tailwind's theme and utilities, never its preflight: a reset would restyle every store, those on CSS Modules too.
const tailwindSheet = (id: string): string => {
  const cached = sheets.get(id)
  if (cached !== undefined) return cached
  const text = readFileSync(require.resolve(id), 'utf8')
  sheets.set(id, text)
  return text
}
const loadStylesheet = async (id: string, base: string) => {
  if (id !== 'tailwindcss/theme.css' && id !== 'tailwindcss/utilities.css') throw new Error(`${id} isn't a stylesheet a theme may import.`)
  return { path: id, base, content: tailwindSheet(id) }
}

/** The stylesheet Tailwind compiles: its theme and utilities, then the theme's own tokens (`theme.css`). */
const entry = (themeCss: string) => ["@import 'tailwindcss/theme.css' layer(theme);", "@import 'tailwindcss/utilities.css' layer(utilities);", themeCss].join('\n')

type Design = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>
const designs = new Map<string, Promise<Design>>()
// A studio session validates the same theme.css change after change, so its design system is kept (a few at most).
const designFor = (themeCss: string): Promise<Design> => {
  const cached = designs.get(themeCss)
  if (cached) return cached
  const loading = __unstable__loadDesignSystem(entry(themeCss), { base: '/', loadStylesheet })
  if (designs.size >= 4) designs.delete(designs.keys().next().value ?? '')
  designs.set(themeCss, loading)
  // A theme.css Tailwind can't read is refused, never kept: the next change tries it afresh.
  loading.catch(() => designs.delete(themeCss))
  return loading
}

/** One whitespace-separated word of a string in the theme's code, and whether it sits where a class goes. */
type Word = { file: string; line: number; text: string; inClass: boolean }

const isClassName = (node: ts.Node) => ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'className'

/** Whether a string reaches a `className` or a `clsx()` argument through the expressions that pass a value on unchanged. */
export const inClassPosition = (node: ts.Node, clsx: ReadonlySet<string>): boolean => {
  let at: ts.Node = node
  for (;;) {
    const parent = at.parent
    if (isClassName(parent)) return true
    if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && clsx.has(parent.expression.text)) return parent.expression !== at
    const passes =
      ts.isJsxExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isArrayLiteralExpression(parent) || ts.isTemplateSpan(parent) ||
      ts.isTemplateExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) ||
      (ts.isConditionalExpression(parent) && parent.condition !== at) ||
      (ts.isBinaryExpression(parent) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(parent.operatorToken.kind) && !(parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.left === at)) ||
      // clsx({ 'p-4': open }): the key is the class, its value only says when.
      (ts.isPropertyAssignment(parent) && parent.name === at) || ts.isObjectLiteralExpression(parent)
    if (!passes) return false
    at = parent
  }
}

/** The names a file imports clsx under. */
export const clsxNames = (sf: ts.SourceFile): Set<string> => {
  const clsx = new Set<string>()
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.moduleSpecifier.text !== 'clsx') continue
    const clause = s.importClause
    if (clause?.name) clsx.add(clause.name.text)
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const el of clause.namedBindings.elements) clsx.add(el.name.text)
  }
  return clsx
}

/** Every word of every string in the theme's code: what Tailwind would build a class from, with its place. */
const wordsOf = (file: string, text: string): Word[] => {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const clsx = clsxNames(sf)
  const words: Word[] = []
  const add = (node: ts.Node, value: string, inClass: boolean) => {
    const start = node.getStart(sf) + 1
    for (const m of value.matchAll(/\S+/g)) {
      const line = sf.getLineAndCharacterOfPosition(start + (m.index ?? 0)).line + 1
      words.push({ file, line, text: m[0], inClass })
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) add(node, node.text, inClassPosition(node, clsx))
    else if (ts.isIdentifier(node) && ts.isPropertyAssignment(node.parent) && node.parent.name === node && inClassPosition(node, clsx)) add(node, node.text, true)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return words
}

// An arbitrary value may not reach the network or form a word the checks below can't see (ARCHITECTURE §3.4 "Classes").
const arbitraryHazards: [RegExp, string][] = [
  [/\\/, 'an escape'],
  [/[;{}]/, 'a ; { or }'],
  [/url\s*\(/i, 'url('],
  [/@import/i, '@import'],
  [/\/\/|(?:^|[^\w-])(?:javascript|data|vbscript|blob|file|https?|ftp|wss?|mailto|tel|sms):/i, 'an address'],
  [/--tw-/i, "one of Tailwind's own --tw- properties"],
]

const arbitraryProblem = (word: string): string | undefined => {
  if (!/[[(]/.test(word)) return undefined
  const text = word.replaceAll('_', ' ')
  return arbitraryHazards.find(([pattern]) => pattern.test(text))?.[1]
}

const classProblems = (word: Word, css: string | null, context: GuardContext): Problem[] => {
  const at = (rule: RuleId, message: string) => problem(word.file, word.line, rule, message)
  if (css === null) {
    if (!word.inClass || /^(?:group|peer)(?:\/[A-Za-z0-9_-]+)?$/.test(word.text) || word.text.startsWith('df-')) return []
    return [at('class/not-tailwind', `"${word.text}" isn't a Tailwind class or one of this theme's tokens (theme.css); write each class out whole, such as p-4 or bg-ink, or use a CSS Module's class.`)]
  }
  const hazard = arbitraryProblem(word.text)
  if (hazard) return [at('class/arbitrary-value', `The class "${word.text}" holds ${hazard}; an arbitrary value may hold no url(, @import, address or escape. Use a theme token, or core's <MerchantImage> for a picture.`)]
  return checkClassCss(word.text, css, context).map(([rule, message]) => at(rule, `The class "${word.text}": ${message}`))
}

/** The theme's code files and its `theme.css`, from the files that passed the file rules. */
const partsOf = (files: ReadonlyMap<string, string>) => ({
  code: [...files].filter(([path]) => codePath.test(path)),
  themeCss: files.get(themeCssPath) ?? '',
})

/** The classes in the theme's code that Tailwind builds, each with every problem it has. */
const judged = async (files: ReadonlyMap<string, string>, context: GuardContext, tokens = true) => {
  const { code } = partsOf(files)
  const themeCss = tokens ? partsOf(files).themeCss : ''
  const words = code.flatMap(([path, text]) => wordsOf(path, text))
  const design = await designFor(themeCss)
  const unique = [...new Set(words.map((w) => w.text))]
  const built = design.candidatesToCss(unique)
  const css = new Map(unique.map((w, i) => [w, built[i] ?? null]))
  const problems = words.flatMap((w) => classProblems(w, css.get(w.text) ?? null, context))
  return { problems, classes: unique.filter((w) => css.get(w) !== null), themeCss }
}

/** ARCHITECTURE §3.4 "Classes" over the theme: its theme.css under the CSS rules, and every class its code writes. */
export const checkClasses = async (files: ReadonlyMap<string, string>, context: GuardContext, storeData = true): Promise<Problem[]> => {
  const themeCss = files.get(themeCssPath)
  const entryProblems = themeCss === undefined ? [] : checkCss(themeCssPath, themeCss, context, storeData, true)
  if (entryProblems.length === 0) {
    try {
      return (await judged(files, context)).problems
    } catch (error) {
      return [problem(themeCssPath, 1, 'css/theme-entry', `Tailwind can't read theme.css: ${error instanceof Error ? error.message : String(error)}`)]
    }
  }
  // A refused theme.css never reaches Tailwind's compiler: the classes are judged without its tokens, so none is unknown.
  const classes = (await judged(files, context, false)).problems.filter((p) => p.rule !== 'class/not-tailwind')
  return [...entryProblems, ...classes]
}

// The bundle runs after the validator, which read the store's media ids; here a url() is held to a media id's shape.
const noStore: GuardContext = { locales: ['en'], usedPaths: [], mediaIds: [], brand: { name: '-', tagline: null, email: null, phone: null, address: [], socialLinks: [] } }

/**
 * The theme's Tailwind stylesheet: the classes its code writes, built by core's pinned Tailwind, each checked again.
 * Null for a theme that writes none and has no theme.css, such as a store on CSS Modules alone, whose bundle stays as it was.
 */
export const themeStylesheet = async (files: ReadonlyMap<string, string>): Promise<{ ok: true; css: string | null } | { ok: false; problems: Problem[] }> => {
  const refused = await checkClasses(files, noStore, false)
  if (refused.length > 0) return { ok: false, problems: refused }
  const { classes, themeCss } = await judged(files, noStore)
  if (classes.length === 0 && !files.has(themeCssPath)) return { ok: true, css: null }
  const compiler = await compile(entry(themeCss), { base: '/', loadStylesheet })
  // Tailwind's licence banner names its site, and nothing in a store's CSS names an address.
  return { ok: true, css: compiler.build(classes).replace(/^\/\*![^*]*\*\/\s*/, '') }
}

/** The theme's code and theme.css in the repo at `root`, as they are on disk: what Tailwind builds classes from. */
export const readThemeStyling = (root: string): Map<string, string> => {
  let names: string[]
  try {
    names = readdirSync(join(root, 'src/theme'), { recursive: true, encoding: 'utf8' })
  } catch {
    return new Map()
  }
  const paths = names.map((n) => `src/theme/${n.replaceAll('\\', '/')}`).filter((p) => isThemePath(p) && (p.endsWith('.tsx') || p === themeCssPath))
  return new Map(paths.map((p) => [p, readFileSync(join(root, p), 'utf8')]))
}
