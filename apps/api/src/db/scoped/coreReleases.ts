import type { ScopedSql } from './index'

// core_release (DATA-MODEL §7.8): one row per published storefront-core version, in system scope.

export type ReleaseKind = 'major' | 'minor' | 'patch'

const parts = (version: string) => version.split('.').map(Number)

/** How far `version` moved from the newest release below it; the first release counts as a major. */
export const releaseKind = (version: string, previous: string | null): ReleaseKind => {
  if (previous === null) return 'major'
  const [a = 0, b = 0] = parts(version)
  const [pa = 0, pb = 0] = parts(previous)
  return a !== pa ? 'major' : b !== pb ? 'minor' : 'patch'
}

/** Recorded once its image is in both registries; recording it again only moves the image to the new digest. */
export const recordCoreRelease = async (tx: ScopedSql, version: string, sandboxImage: string): Promise<void> => {
  const [previous] = await tx<{ version: string }[]>`
    select version from core_release where core_version_key(version) < core_version_key(${version})
    order by core_version_key(version) desc limit 1`
  await tx`
    insert into core_release (version, kind, sandbox_image) values (${version}, ${releaseKind(version, previous?.version ?? null)}, ${sandboxImage})
    on conflict (version) do update set sandbox_image = excluded.sandbox_image`
}

/** The newest version nothing has retired: what a new store may pin, with its image recorded. */
export const selectNewestRelease = async (tx: ScopedSql): Promise<string | null> =>
  (await tx<{ version: string }[]>`select version from core_release where retired_at is null order by core_version_key(version) desc limit 1`)[0]?.version ?? null
/** A retired version's image is gone, or about to be (AI-STUDIO §9): nothing starts it. */
export const selectSandboxImage = async (tx: ScopedSql, version: string): Promise<string | null> =>
  (await tx<{ sandbox_image: string }[]>`select sandbox_image from core_release where version = ${version} and retired_at is null`)[0]?.sandbox_image ?? null

export interface ReleaseUse {
  version: string
  retired_at: Date | null
  /** Set once `retire-images.yml` deleted its image from Cloudflare's registry; until then it still takes space. */
  image_deleted_at: Date | null
  /** Stores not closed whose live code, own theme under the baseline, draft or waiting major is on the version. */
  stores: number
  /** Of those, the ones a rollout moves: their own code is on it, not pinned, no major waiting (ARCHITECTURE §7). */
  movable: number
}

/** Every release, newest first, with the stores that still need its image (AI-STUDIO §9). */
export const selectReleaseUse = (tx: ScopedSql): Promise<ReleaseUse[]> =>
  tx<ReleaseUse[]>`
    with used as (
      select f.store_id, r.core_version as version, f.core_pinned_reason is null and f.core_upgrade_version is null as movable
      from storefront f join publish_run r on r.id in (f.live_build_id, f.baseline_from_build_id)
      union all select store_id, core_version, false from design_draft
      union all select store_id, core_upgrade_version, false from storefront where core_upgrade_version is not null
    )
    select c.version, c.retired_at, c.image_deleted_at, n.stores, n.movable
    from core_release c
    cross join lateral (
      select count(distinct u.store_id)::int as stores, (count(distinct u.store_id) filter (where u.movable))::int as movable
      from used u join store s on s.id = u.store_id where u.version = c.version and s.status <> 'closed'
    ) n
    order by core_version_key(c.version) desc`

export const retireRelease = async (tx: ScopedSql, version: string, at: Date): Promise<void> => {
  await tx`update core_release set retired_at = ${at} where version = ${version} and retired_at is null`
}

/** Retired versions whose image the scheduled workflow hasn't deleted from Cloudflare's registry yet. */
export const selectImagesToDelete = async (tx: ScopedSql): Promise<string[]> =>
  (await tx<{ version: string }[]>`select version from core_release where retired_at is not null and image_deleted_at is null order by retired_at`).map((r) => r.version)

export const markImageDeleted = async (tx: ScopedSql, version: string, at: Date): Promise<void> => {
  await tx`update core_release set image_deleted_at = ${at} where version = ${version} and retired_at is not null`
}
