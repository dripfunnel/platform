/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isThemePath } from './files.js'
import { localePattern, type GuardResult, type ThemeFile } from './rules.js'
import { storeDataChecks, validateLocally } from './validate.js'

// A store repo's `pnpm check` (`dripfunnel-check`, storefront ARCHITECTURE §3.4, #974): the validator over what a push
// would carry, before a push to main goes live.

// Where a theme's files live (files.ts `isThemePath`), so git never lists an untracked node_modules.
const themeRoots = ['src/theme', 'content', 'routes.json']
const maxBuffer = 64 * 1024 * 1024

/** Every theme path git holds, staged changes included, and whether git holds it as a link: what a commit would carry. */
const tracked = (root: string) =>
  execFileSync('git', ['ls-files', '-z', '--stage', '--', ...themeRoots], { cwd: root, encoding: 'utf8', maxBuffer })
    .split('\0')
    .filter(Boolean)
    .map((entry) => ({ path: entry.slice(entry.indexOf('\t') + 1), link: entry.startsWith('120000 ') }))

/** Theme files on disk that git doesn't hold yet: a push leaves them out, so the build never sees them. */
const unadded = (root: string) =>
  execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard', '--', ...themeRoots], { cwd: root, encoding: 'utf8', maxBuffer })
    .split('\0')
    .filter(isThemePath)

// The build refuses a link as it does; a tracked file deleted on disk isn't part of what is checked.
const themeFilesIn = (root: string): ThemeFile[] =>
  tracked(root)
    .filter(({ path }) => isThemePath(path) && existsSync(join(root, path)))
    .map(({ path, link }) => (link ? { path, content: '', symlink: true } : { path, content: readFileSync(join(root, path), 'utf8') }))

const localesIn = (root: string): string[] => {
  const content = join(root, 'content')
  return statSync(content, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(content).filter((name) => localePattern.test(name) && statSync(join(content, name)).isDirectory()) : []
}

const report = (result: GuardResult, left: readonly string[]): string[] => [
  ...result.problems.map((p) => `${p.file ?? 'theme'}${p.line === null ? '' : `:${p.line}`}  ${p.rule}  ${p.message}`),
  ...left.map((path) => `${path}  not added to git: a push leaves it out, so the build won't see it`),
  result.ok ? 'The theme passes the validator.' : `${result.problems.length} problem(s): the build would refuse this push.`,
  `Checked when you push, not here: ${storeDataChecks.join('; ')}.`,
]

/** The repo at `root` through the validator, with its languages taken from content/. */
export const runCheck = (root: string): { code: 0 | 1; lines: string[] } => {
  const locales = localesIn(root)
  if (locales.length === 0 || !existsSync(join(root, '.git'))) return { code: 1, lines: ["Run pnpm check from the store repo's root: it needs the repo's .git and content/{language} folders."] }
  const result = validateLocally(themeFilesIn(root), locales)
  return { code: result.ok ? 0 : 1, lines: report(result, unadded(root)) }
}
