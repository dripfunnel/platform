import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordCoreRelease } from '#db/scoped/coreReleases'
import { withSystemScope } from '#db/scoped/index'
import { startReleaseRollout } from '#saas/fleet/index'
import { createTestDatabase, type TestDatabase } from './support/database'

// A promoted release starts its own rollout (SAAS §10), never a second one while another runs or is paused.

let db: TestDatabase
const image = (n: number) => `registry.cloudflare.com/acct123/storefront-build@sha256:${n.toString(16).padStart(64, '0')}`
const release = (version: string, n: number) =>
  withSystemScope(db.sql, async (tx) => {
    await recordCoreRelease(tx, version, image(n))
    return startReleaseRollout(tx, version, new Date())
  })
const entries = (action: string) => db.sql<{ target_id: string; actor_kind: string; actor_id: string; result: string; reason: string }[]>`select target_id, actor_kind, actor_id, result, reason from activity_log where action = ${action} order by occurred_at`

beforeAll(async () => {
  db = await createTestDatabase()
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('a release’s own rollout', () => {
  it('starts the recorded version’s rollout as the release job, and none again when the same version is recorded twice', async () => {
    const first = await release('1.0.0', 1)
    expect(first).toEqual({ started: expect.any(String) })
    const id = 'started' in first ? first.started : ''
    const [rollout] = await db.sql<{ version: string; started_by: string | null; state: string; security: boolean }[]>`select version, started_by, state, security from core_rollout where id = ${id}`
    expect(rollout).toEqual({ version: '1.0.0', started_by: null, state: 'canary', security: false })
    expect(await entries('core_rollout.started')).toEqual([{ target_id: id, actor_kind: 'job', actor_id: 'core-release', result: 'success', reason: 'release' }])
    // Recording the version again only moves its image.
    expect(await release('1.0.0', 2)).toEqual({ skipped: 'already_rolled_out' })
    await db.sql`update core_rollout set state = 'done'`
    expect(await release('1.0.0', 3)).toEqual({ skipped: 'already_rolled_out' })
    expect(await db.sql`select 1 from core_rollout`).toHaveLength(1)
  })

  it('skips the release and says why while another rollout is running or paused, then starts the next one once it ended', async () => {
    const running = await release('1.1.0', 4)
    expect(running).toEqual({ started: expect.any(String) })
    await db.sql`update core_rollout set state = 'paused', paused_state = 'canary' where version = '1.1.0'`
    expect(await release('1.2.0', 5)).toEqual({ skipped: 'rollout_active', active: '1.1.0' })
    expect(await entries('core_rollout.not_started')).toEqual([{ target_id: '1.2.0', actor_kind: 'job', actor_id: 'core-release', result: 'failed', reason: 'rollout_active' }])
    expect(await db.sql`select 1 from core_rollout where version = '1.2.0'`).toHaveLength(0)
    await db.sql`update core_rollout set state = 'rolled_back', paused_state = null where version = '1.1.0'`
    expect(await release('1.3.0', 6)).toEqual({ started: expect.any(String) })
  })

  it('starts nothing for a version core_release doesn’t hold', async () => {
    expect(await withSystemScope(db.sql, (tx) => startReleaseRollout(tx, '9.9.9', new Date()))).toEqual({ skipped: 'not_recorded' })
  })
})
