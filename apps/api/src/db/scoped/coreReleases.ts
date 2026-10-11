import type { ScopedSql } from './index'

// core_release (DATA-MODEL §7.8): one row per published storefront-core version, in system scope.

export type ReleaseKind = 'major' | 'minor' | 'patch'

const parts = (version: string) => version.split('.').map(Number)

/** How far `version` moved from the newest release before it; the first release counts as a major. */
export const releaseKind = (version: string, previous: string | null): ReleaseKind => {
  if (previous === null) return 'major'
  const [a = 0, b = 0] = parts(version)
  const [pa = 0, pb = 0] = parts(previous)
  return a !== pa ? 'major' : b !== pb ? 'minor' : 'patch'
}

/** Recorded once its image is in both registries; recording it again only moves the image to the new digest. */
export const recordCoreRelease = async (tx: ScopedSql, version: string, sandboxImage: string): Promise<void> => {
  const [previous] = await tx<{ version: string }[]>`
    select version from core_release where version <> ${version}
    order by string_to_array(version, '.')::int[] desc limit 1`
  await tx`
    insert into core_release (version, kind, sandbox_image) values (${version}, ${releaseKind(version, previous?.version ?? null)}, ${sandboxImage})
    on conflict (version) do update set sandbox_image = excluded.sandbox_image`
}

export const selectSandboxImage = async (tx: ScopedSql, version: string): Promise<string | null> =>
  (await tx<{ sandbox_image: string }[]>`select sandbox_image from core_release where version = ${version}`)[0]?.sandbox_image ?? null
