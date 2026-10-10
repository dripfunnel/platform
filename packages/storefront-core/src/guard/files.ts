import { problem, type GuardContext, type Problem, type ThemeFile } from './rules'

export const maxFiles = 200
export const maxFileBytes = 100 * 1024
export const maxThemeBytes = 2 * 1024 * 1024

// Plain ASCII names only, so no `..`, `.`, case trick, look-alike letter or backslash can name another file.
const name = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}'
const folders = `(?:${name}/){0,4}`

export const codePath = new RegExp(`^src/theme/(?:pages|components)/${folders}${name}\\.tsx$`)
export const cssPath = new RegExp(`^src/theme/styles/${folders}${name}\\.module\\.css$`)
export const contentPath = /^content\/([a-z]{2,3}(?:-[A-Z]{2})?)\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.json$/
export const routesPath = 'routes.json'
export const interactiveFolder = 'src/theme/components/interactive/'

const allowed = (path: string) => codePath.test(path) || cssPath.test(path) || contentPath.test(path) || path === routesPath

const allowedMessage =
  'A theme may write only src/theme/pages/**/*.tsx, src/theme/components/**/*.tsx, src/theme/styles/**/*.module.css, content/{language}/*.json and routes.json.'

const lockedMessage = (path: string) =>
  path.startsWith('.github/') ? `${path} is the locked build workflow, which only the platform writes. ${allowedMessage}` : `${path} is outside the theme. ${allowedMessage}`

const bytes = (text: string) => new TextEncoder().encode(text).byteLength

/** The file allowlist and the size caps (ARCHITECTURE §3.4 "Files"), and the files that passed them by path. */
export const checkFiles = (input: readonly ThemeFile[], context: GuardContext): { problems: Problem[]; files: Map<string, string> } => {
  const problems: Problem[] = []
  if (input.length > maxFiles) problems.push(problem(null, null, 'files/too-many-files', `The theme would have ${input.length} files; it may have at most ${maxFiles}.`))
  const total = input.reduce((sum, f) => sum + bytes(f.content), 0)
  if (total > maxThemeBytes) problems.push(problem(null, null, 'files/theme-too-large', `The theme would be ${total} bytes; it may be at most ${maxThemeBytes}.`))

  const files = new Map<string, string>()
  // Two names a case-insensitive disk folds together would be one file there.
  const seen = new Set<string>()
  for (const f of input) {
    const folded = f.path.toLowerCase()
    if (seen.has(folded)) {
      problems.push(problem(f.path, null, 'files/duplicate-path', 'Another file in the change has this path, or one that differs only in case.'))
      continue
    }
    seen.add(folded)
    if (!allowed(f.path)) {
      problems.push(problem(f.path, null, 'files/path-not-allowed', lockedMessage(f.path)))
      continue
    }
    if (f.symlink) {
      problems.push(problem(f.path, null, 'files/symlink', 'A theme file must be a plain file, never a link to another one.'))
      continue
    }
    const locale = contentPath.exec(f.path)?.[1]
    if (locale !== undefined && !context.locales.includes(locale)) {
      problems.push(problem(f.path, null, 'files/locale-not-offered', `The store doesn't offer "${locale}"; write words only for ${context.locales.join(', ')}.`))
      continue
    }
    const size = bytes(f.content)
    if (size > maxFileBytes) {
      problems.push(problem(f.path, null, 'files/file-too-large', `This file is ${size} bytes; a theme file may be at most ${maxFileBytes}.`))
      continue
    }
    files.set(f.path, f.content)
  }
  return { problems, files }
}
