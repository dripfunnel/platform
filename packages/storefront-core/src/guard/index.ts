import { checkContent } from './content'
import { checkFiles } from './files'
import { checkRoutes } from './routes'
import { guardContextSchema, themeFileSchema, type GuardContext, type GuardResult, type Problem, type ThemeFile } from './rules'

export { maxFileBytes, maxFiles, maxThemeBytes } from './files'
export { ruleIds, type GuardContext, type GuardResult, type Problem, type RuleId, type ThemeFile } from './rules'

const byPlace = (a: Problem, b: Problem) => (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule)

/**
 * The validator (storefront ARCHITECTURE §3.4) over the whole theme as it would be after a change: every file under
 * src/theme, content and routes.json, plus any other path the change writes. One problem refuses the whole change.
 */
export const validateChange = (files: readonly ThemeFile[], context: GuardContext): GuardResult => {
  const input = themeFileSchema.array().parse(files)
  const store = guardContextSchema.parse(context)
  const checked = checkFiles(input, store)
  const problems = [...checked.problems, ...checkContent(checked.files, store), ...checkRoutes(checked.files, store)].sort(byPlace)
  return { ok: problems.length === 0, problems }
}
