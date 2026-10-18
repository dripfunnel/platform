// The paths a theme may write (storefront ARCHITECTURE §3.4 "Files"), as storefront-core's guard/files.ts has them. The
// guard can't be bundled into the Worker (it carries the TypeScript compiler), so the push checks its own copy.
const name = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}'
const folders = `(?:${name}/){0,4}`
const themePaths = [
  new RegExp(`^src/theme/(?:pages|components)/${folders}${name}\\.tsx$`),
  new RegExp(`^src/theme/styles/${folders}${name}\\.module\\.css$`),
  /^content\/[a-z]{2,3}(?:-[A-Z]{2})?\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/,
  /^routes\.json$/,
]

/** The theme: what a publish or a template change writes and replaces as a whole; anything else under src/theme stays. */
export const isThemePath = (path: string): boolean => themePaths.some((p) => p.test(path))

/** The locked workflow's folder (LIVE-SHOP.md §3 step 4): written once, with the repo, and never pushed to. */
export const isLockedPath = (path: string): boolean => path.toLowerCase().startsWith('.github/')

/** Plain relative names, so no `..`, absolute or empty segment reaches outside the repo. */
export const isRepoPath = (path: string): boolean => path.length <= 512 && path.split('/').every((s) => /^[A-Za-z0-9_.-]{1,100}$/.test(s) && s !== '.' && s !== '..')
/** A storefront-core version: `1.2.3`, or `0.0.0-dev.6` from the dev release. */
export const coreVersionPattern = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
