// The paths the AI may write (storefront ARCHITECTURE §3.4 "Files"), as the API's saas/storefronts/paths.ts has them;
// core's guard also takes src/theme/media/ from a person's push (#1405). Nothing is written before the validator passes.
const name = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}'
const folders = `(?:${name}/){0,4}`
const themePaths = [
  new RegExp(`^src/theme/(?:pages|components)/${folders}${name}\\.tsx$`),
  new RegExp(`^src/theme/styles/${folders}${name}\\.module\\.css$`),
  /^src\/theme\/styles\/theme\.css$/,
  /^content\/[a-z]{2,3}(?:-[A-Z]{2})?\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/,
  /^routes\.json$/,
]

export const isThemePath = (path: string): boolean => themePaths.some((p) => p.test(path))

export const isThemeCode = (path: string): boolean => path.startsWith('src/theme/') && path.endsWith('.tsx')

// A plain name, or a Next.js dynamic segment such as the template's theme-media/[name] (#1420).
const repoSegment = /^(?:[A-Za-z0-9_.-]{1,100}|\[(?:\.\.\.)?[A-Za-z0-9_-]{1,64}\]|\[\[\.\.\.[A-Za-z0-9_-]{1,64}\]\])$/

/** Plain relative names, so no `..`, absolute or empty segment reaches outside the repo. */
export const isRepoPath = (path: string): boolean => path.length <= 512 && path.split('/').every((s) => repoSegment.test(s) && s !== '.' && s !== '..')

// The template files an upgrade never writes (storefront ARCHITECTURE §2.2, §7.1): the theme's, the generated ones, core's
// pin (written on its own), the locked workflow, and git's or the install's own folders (a hook would run on the commit).
const notRefreshed = /^(?:src\/theme\/|content\/|\.github\/)|^(?:routes\.json|package\.json|store\.config\.ts|\.env\.development)$|(?:^|\/)(?:\.git|node_modules)(?:\/|$)/i

/** A template file an upgrade refreshes from the skeleton of the core it upgrades to (#1416). */
export const isRefreshedPath = (path: string): boolean => isRepoPath(path) && !notRefreshed.test(path)
