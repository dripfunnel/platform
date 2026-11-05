import { checkCode } from './code.js'
import { checkContent } from './content.js'
import { checkCss } from './css.js'
import { checkFiles, codePath, cssPath } from './files.js'
import { checkRoutes } from './routes.js'
import { guardContextSchema, themeFileSchema, type GuardContext, type GuardResult, type Problem, type ThemeFile } from './rules.js'
import { checkClasses } from './tailwind.js'

const byPlace = (a: Problem, b: Problem) => (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule)

/** `storeData` false: every rule reading the store's brand, media ids or used paths leaves them unread (#974). */
const validate = (files: readonly ThemeFile[], context: GuardContext, storeData: boolean, classes = false): GuardResult & { files: Map<string, string>; store: GuardContext } => {
  const input = themeFileSchema.array().parse(files)
  const store = guardContextSchema.parse(context)
  const checked = checkFiles(input, store)
  const code = new Map([...checked.files].filter(([path]) => codePath.test(path)))
  const { problems: codeProblems, keys } = checkCode(code, new Set(checked.files.keys()), store, storeData, classes, checked.files)
  const css = [...checked.files].filter(([path]) => cssPath.test(path)).flatMap(([path, text]) => checkCss(path, text, store, storeData))
  const problems = [...checked.problems, ...codeProblems, ...css, ...checkContent(checked.files, keys, store, storeData), ...checkRoutes(checked.files, store, storeData)].sort(byPlace)
  return { ok: problems.length === 0, problems, files: checked.files, store }
}

// A string a class rule reads isn't words, since every word of it must be a Tailwind class (code.ts checkText).
const withClasses = async (files: readonly ThemeFile[], context: GuardContext, storeData: boolean): Promise<GuardResult> => {
  const result = validate(files, context, storeData, true)
  const problems = [...result.problems, ...(await checkClasses(result.files, result.store, storeData))].sort(byPlace)
  return { ok: problems.length === 0, problems }
}

/**
 * The validator (storefront ARCHITECTURE §3.4) over the whole theme as it would be after a change: every file under
 * src/theme, content and routes.json, plus any other path the change writes. One problem refuses the whole change.
 */
export const validateChange = (files: readonly ThemeFile[], context: GuardContext): GuardResult => {
  const { ok, problems } = validate(files, context, true)
  return { ok, problems }
}

/** validateChange with the Tailwind class rules (ARCHITECTURE §3.4 "Classes"), which need Tailwind's compiler: the validator. */
export const validateTheme = (files: readonly ThemeFile[], context: GuardContext): Promise<GuardResult> => withClasses(files, context, true)

/** What a local check leaves to the build, for lack of the store's data (storefront ARCHITECTURE §3.4). */
export const storeDataChecks = [
  "that the content/ folders are exactly the store's languages",
  "copying the store's name or contact details",
  "whether a CSS url() names one of the store's images",
  'a custom page address already in use',
] as const

// Never read: `storeData` false skips every rule that would, and the schema still wants a brand.
const unread: GuardContext['brand'] = { name: '-', tagline: null, email: null, phone: null, address: [], socialLinks: [] }

/** The validator on a developer's machine (`dripfunnel-check`): every rule but `storeDataChecks`, in the repo's languages. */
export const validateLocally = (files: readonly ThemeFile[], locales: readonly string[]): Promise<GuardResult> =>
  withClasses(files, { locales: [...locales], usedPaths: [], mediaIds: [], brand: unread }, false)
