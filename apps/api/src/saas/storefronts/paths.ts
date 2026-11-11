// The paths the AI may write (storefront ARCHITECTURE §3.4 "Files"); core's guard also takes src/theme/media/ from a
// person's push (#1405), which a publish leaves in place. The guard can't be bundled into the Worker, so this is a copy.
const name = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}'
const folders = `(?:${name}/){0,4}`
const themePaths = [
  new RegExp(`^src/theme/(?:pages|components)/${folders}${name}\\.tsx$`),
  new RegExp(`^src/theme/styles/${folders}${name}\\.module\\.css$`),
  /^src\/theme\/styles\/theme\.css$/,
  /^content\/[a-z]{2,3}(?:-[A-Z]{2})?\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/,
  /^routes\.json$/,
]

/** The theme: what a publish or a template change writes and replaces as a whole; anything else under src/theme stays. */
export const isThemePath = (path: string): boolean => themePaths.some((p) => p.test(path))

/** The locked workflow's folder (LIVE-SHOP.md §3 step 4): written once, with the repo, and never pushed to. */
export const isLockedPath = (path: string): boolean => path.toLowerCase().startsWith('.github/')

// A copy of the sandbox's: an upgrade never writes the theme, the generated files, package.json beyond core's pin (written
// on its own), the locked workflow, or git's and the install's own folders (storefront ARCHITECTURE §2.2, §7.1).
const notRefreshed = /^(?:src\/theme\/|content\/|\.github\/)|^(?:routes\.json|package\.json|store\.config\.ts|\.env\.development)$|(?:^|\/)(?:\.git|node_modules)(?:\/|$)/i

/** A template file an upgrade refreshes from the skeleton of the core it upgrades to (#1416). */
export const isRefreshedPath = (path: string): boolean => isRepoPath(path) && !notRefreshed.test(path)

/** Plain relative names, so no `..`, absolute or empty segment reaches outside the repo. */
export const isRepoPath = (path: string): boolean => path.length <= 512 && path.split('/').every((s) => /^[A-Za-z0-9_.-]{1,100}$/.test(s) && s !== '.' && s !== '..')
/** A storefront-core version: `1.2.3`, or `0.0.0-dev.6` from the dev release. */
export const coreVersionPattern = /^\d+\.\d+\.\d+(-dev\.\d+)?$/
