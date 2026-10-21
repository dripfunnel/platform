import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { recordCoreRelease, selectImagesToDelete, selectSandboxImage } from '#db/scoped/coreReleases'
import { withSystemScope } from '#db/scoped/index'
import { imageBudget, keptImages, recordImageDeleted, retireCoreImages } from '#saas/fleet/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #485 part 5: old core versions' studio images (storefront AI-STUDIO §9). The newest 20 always keep theirs; an
// older one is retired once no store needs it, after a forced rollout moved the stores it can.

let db: TestDatabase
let t: Tenants
const image = (n: number) => `registry.cloudflare.com/acct123/storefront-build@sha256:${n.toString(16).padStart(64, '0')}`
const version = (minor: number) => `1.${minor}.0`

/** A store live on `v` through a build of its own. */
const liveOn = async (storeId: string, v: string) => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind)
    values (${storeId}, 'design', 'live', ${'a'.repeat(40)}, 'linen', ${v}, 'system') returning id`
  await db.sql`update storefront set live_build_id = ${run?.id ?? ''} where store_id = ${storeId}`
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await withSystemScope(db.sql, async (tx) => {
    for (let minor = 0; minor < 23; minor += 1) await recordCoreRelease(tx, version(minor), image(minor + 1))
  })
  await liveOn(t.storeA1, version(0))
  await db.sql`insert into design_draft (store_id, head_commit, template, core_version) values (${t.storeA2}, ${'b'.repeat(40)}, 'linen', ${version(1)})`
  // A closed store's code needs no image.
  await liveOn(t.storeB1, version(2))
  await db.sql`update store set status = 'closed', closed_at = now() where id = ${t.storeB1}`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the retirement of old core images', () => {
  it('retires an old version no store needs, and moves the stores still on old ones with a forced rollout first', async () => {
    expect(keptImages).toBeLessThan(imageBudget)
    const first = await retireCoreImages(db.sql, new Date())
    expect(first.retired).toEqual([version(2)])
    expect(first).toMatchObject({ kept: 22, held: 23 })
    expect(await withSystemScope(db.sql, (tx) => selectSandboxImage(tx, version(2)))).toBeNull()
    const retiredEntries = await db.sql<{ target_id: string; actor_kind: string; actor_id: string; reason: string; visibility: string }[]>`select target_id, actor_kind, actor_id, reason, visibility from activity_log where action = 'core_release.retired'`
    expect(retiredEntries).toEqual([{ target_id: version(2), actor_kind: 'job', actor_id: 'core-images', reason: 'retire_images', visibility: 'staff' }])
    expect(await withSystemScope(db.sql, (tx) => selectSandboxImage(tx, version(0)))).toBe(image(1))
    const [rollout] = await db.sql<{ version: string; started_by: string | null; state: string }[]>`select version, started_by, state from core_rollout where id = ${first.rolloutId ?? ''}`
    expect(rollout).toEqual({ version: version(22), started_by: null, state: 'canary' })
    const [entry] = await db.sql<{ actor_kind: string; reason: string }[]>`select actor_kind, reason from activity_log where target_id = ${first.rolloutId ?? ''}`
    expect(entry).toEqual({ actor_kind: 'job', reason: 'retire_images' })
    // One rollout at a time: the next day waits for it.
    expect((await retireCoreImages(db.sql, new Date())).rolloutId).toBeNull()
  })

  it('retires the rest once the stores moved, and the workflow deletes each image once', async () => {
    await db.sql`update core_rollout set state = 'done'`
    await liveOn(t.storeA1, version(22))
    await db.sql`update design_draft set core_version = ${version(22)} where store_id = ${t.storeA2}`
    const done = await retireCoreImages(db.sql, new Date())
    expect(done.retired.sort()).toEqual([version(0), version(1)])
    expect(done.rolloutId).toBeNull()
    // Retired, but in the registry until the workflow deletes them.
    expect(done).toMatchObject({ kept: 20, held: 23 })
    expect(await withSystemScope(db.sql, selectImagesToDelete)).toEqual(expect.arrayContaining([version(0), version(1), version(2)]))
    await withSystemScope(db.sql, (tx) => recordImageDeleted(tx, version(2), new Date()))
    expect(await withSystemScope(db.sql, selectImagesToDelete)).not.toContain(version(2))
    const deletedEntries = await db.sql<{ target_id: string; actor_id: string; reason: string }[]>`select target_id, actor_id, reason from activity_log where action = 'core_release.image_deleted'`
    expect(deletedEntries).toEqual([{ target_id: version(2), actor_id: 'retire-images', reason: 'retire_images' }])
    expect(await db.sql`select 1 from activity_log where action = 'core_release.retired'`).toHaveLength(3)
    // The newest twenty are never retired, whatever uses them.
    expect(await db.sql`select 1 from core_release where retired_at is not null and string_to_array(version, '.')::int[] >= '{1,3,0}'::int[]`).toHaveLength(0)
  })

  it('starts no rollout for stores one cannot move, and alerts past the budget', async () => {
    await db.sql`update core_rollout set state = 'done'`
    await withSystemScope(db.sql, async (tx) => {
      for (let minor = 23; minor < 29; minor += 1) await recordCoreRelease(tx, version(minor), image(minor + 1))
    })
    // Pinned on 1.3, its own theme under the baseline on 1.8 and a major waiting on 1.4; a draft on 1.5; live on 1.6 with a major waiting on 1.7.
    await liveOn(t.storeA1, version(8))
    await db.sql`update storefront set baseline_from_build_id = live_build_id where store_id = ${t.storeA1}`
    await liveOn(t.storeA1, version(3))
    await db.sql`update storefront set core_pinned_reason = 'gate_failed', core_upgrade_version = ${version(4)}, core_upgrade_commit = ${'c'.repeat(40)} where store_id = ${t.storeA1}`
    await db.sql`update design_draft set core_version = ${version(5)} where store_id = ${t.storeA2}`
    await liveOn(t.storeA2, version(6))
    await db.sql`update storefront set core_upgrade_version = ${version(7)}, core_upgrade_commit = ${'d'.repeat(40)} where store_id = ${t.storeA2}`
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => void lines.push(String(line)))
    try {
      const pinned = await retireCoreImages(db.sql, new Date())
      // 26 versions kept, and 1.0 and 1.1 retired but not yet deleted (their deletes failed): 28 images take space.
      expect(pinned).toEqual({ retired: [], rolloutId: null, kept: 26, held: 28 })
    } finally {
      spy.mockRestore()
    }
    expect(lines.map((l) => JSON.parse(l) as unknown)).toContainEqual({ event: 'core_images_over_budget', api: 'system', code: 'over_budget', count: 28 })
  })

  it('moves an unpinned store with one rollout per release, never again after it ran', async () => {
    await db.sql`update storefront set core_pinned_reason = null, core_upgrade_version = null, core_upgrade_commit = null where store_id = ${t.storeA1}`
    const started = await retireCoreImages(db.sql, new Date())
    const [rollout] = await db.sql<{ version: string }[]>`select version from core_rollout where id = ${started.rolloutId ?? ''}`
    expect(rollout).toEqual({ version: version(28) })
    // Rolled back by staff: the job doesn't start the same release again the next day.
    await db.sql`update core_rollout set state = 'rolled_back' where id = ${started.rolloutId ?? ''}`
    expect((await retireCoreImages(db.sql, new Date())).rolloutId).toBeNull()
  })
})
