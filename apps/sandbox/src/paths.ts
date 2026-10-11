// The paths a theme may write (storefront ARCHITECTURE §3.4 "Files"), as core's guard/files.ts and the API's
// saas/storefronts/paths.ts have them. A change is written to disk only after the validator accepted every path.
const name = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}'
const folders = `(?:${name}/){0,4}`
const themePaths = [
  new RegExp(`^src/theme/(?:pages|components)/${folders}${name}\\.tsx$`),
  new RegExp(`^src/theme/styles/${folders}${name}\\.module\\.css$`),
  /^content\/[a-z]{2,3}(?:-[A-Z]{2})?\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/,
  /^routes\.json$/,
]

export const isThemePath = (path: string): boolean => themePaths.some((p) => p.test(path))

export const isThemeCode = (path: string): boolean => path.startsWith('src/theme/') && path.endsWith('.tsx')

/** Plain relative names, so no `..`, absolute or empty segment reaches outside the repo. */
export const isRepoPath = (path: string): boolean => path.length <= 512 && path.split('/').every((s) => /^[A-Za-z0-9_.-]{1,100}$/.test(s) && s !== '.' && s !== '..')
