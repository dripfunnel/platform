import { z } from 'zod'
import { isThemePath } from '../files.js'

// Core's structured release notes (storefront ARCHITECTURE §7.1): what each release changed for themes, and the codemods
// the upgrade bot applies to every store's theme on its way to that release.

const semver = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
const themePath = z.string().refine(isThemePath, 'a codemod names only theme paths')
// `*` is one path segment's characters, `**` any number of whole segments.
const glob = z.string().regex(/^[A-Za-z0-9_.*/-]{1,200}$/)

export const codemodSchema = z.discriminatedUnion('kind', [
  /** Every occurrence of `find`, literally, in the theme files `paths` match. */
  z.strictObject({ kind: z.literal('replace'), paths: z.array(glob).min(1).max(20), find: z.string().min(1).max(2000), replace: z.string().max(2000) }),
  /** A theme file moved; nothing happens when `from` is missing or `to` is taken. */
  z.strictObject({ kind: z.literal('rename'), from: themePath, to: themePath }),
])
export type Codemod = z.infer<typeof codemodSchema>

export const upgradeNoteSchema = z.strictObject({
  version: semver,
  kind: z.enum(['major', 'minor', 'patch']),
  /** A security fix reaches every store, with the baseline theme for one that can't take it (ARCHITECTURE §7). */
  security: z.boolean(),
  /** What a theme has to change, in plain words: the migration agent's instructions. */
  notes: z.string().min(1).max(8000),
  codemods: z.array(codemodSchema).max(100),
})
export type UpgradeNote = z.infer<typeof upgradeNoteSchema>

/**
 * One entry per release that changes anything for themes, added by its release card (docs/code/ARCHITECTURE.md §5
 * "Releases"); a release with no entry needs no codemod.
 */
export const coreUpgradeNotes: readonly UpgradeNote[] = []

const parts = (version: string) => version.split('-')[0]?.split('.').map(Number) ?? []
const devRun = (version: string) => Number(version.split('-dev.')[1] ?? Number.POSITIVE_INFINITY)

/** Semver order of two `x.y.z` or `x.y.z-dev.<run>` versions: negative when `a` is older; a release is newer than its dev builds. */
export const compareVersions = (a: string, b: string): number => {
  const [pa, pb] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  const [ra, rb] = [devRun(a), devRun(b)]
  return ra === rb ? 0 : ra < rb ? -1 : 1
}

/** The notes of every release after `from`, up to and including `to`, oldest first. */
export const notesBetween = (from: string, to: string, notes: readonly UpgradeNote[] = coreUpgradeNotes): UpgradeNote[] =>
  notes.filter((n) => compareVersions(n.version, from) > 0 && compareVersions(n.version, to) <= 0).sort((a, b) => compareVersions(a.version, b.version))
