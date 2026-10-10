import { checkCode } from './code.js'
import { checkContent } from './content.js'
import { checkFiles, codePath } from './files.js'
import { checkRoutes } from './routes.js'
import { guardContextSchema, themeFileSchema, type GuardContext, type GuardResult, type Problem, type ThemeFile } from './rules.js'

export { maxFileBytes, maxFiles, maxThemeBytes } from './files.js'
export { ruleIds, type GuardContext, type GuardResult, type Problem, type RuleId, type ThemeFile } from './rules.js'

const byPlace = (a: Problem, b: Problem) => (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule)

/**
 * The validator (storefront ARCHITECTURE §3.4) over the whole theme as it would be after a change: every file under
 * src/theme, content and routes.json, plus any other path the change writes. One problem refuses the whole change.
 */
export const validateChange = (files: readonly ThemeFile[], context: GuardContext): GuardResult => {
  const input = themeFileSchema.array().parse(files)
  const store = guardContextSchema.parse(context)
  const checked = checkFiles(input, store)
  const code = new Map([...checked.files].filter(([path]) => codePath.test(path)))
  const { problems: codeProblems, keys } = checkCode(code, new Set(checked.files.keys()), store)
  const problems = [...checked.problems, ...codeProblems, ...checkContent(checked.files, keys, store), ...checkRoutes(checked.files, store)].sort(byPlace)
  return { ok: problems.length === 0, problems }
}
