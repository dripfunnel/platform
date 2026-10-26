import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordCoreRelease, releaseKind, resolveReleasedCore, retireRelease, selectNewestRelease, selectSandboxImage } from '#db/scoped/coreReleases'
import { withSystemScope } from '#db/scoped/index'
import { createTestDatabase, type TestDatabase } from './support/database'

// INF 3 (#482): the release workflow records each core version's sandbox image (DATA-MODEL §7.8, AI-STUDIO §1).

let db: TestDatabase
const image = (n: string) => `registry.cloudflare.com/acct123/storefront-build@sha256:${n.repeat(64)}`

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db.drop()
})

const as = (role: string, scope: string, work: (tx: postgres.TransactionSql) => Promise<unknown>) =>
  db.sql.begin(async (tx: postgres.TransactionSql) => {
    await tx.unsafe(`set local role ${role}`)
    await tx`select set_config('app.scope', ${scope}, true)`
    return work(tx)
  })

describe('core_release', () => {
  it('names how far a version moved from the newest one before it', () => {
    expect(releaseKind('1.0.0', null)).toBe('major')
    expect(releaseKind('2.0.0', '1.4.2')).toBe('major')
    expect(releaseKind('1.5.0', '1.4.2')).toBe('minor')
    expect(releaseKind('1.4.3', '1.4.2')).toBe('patch')
  })

  it('records a version once, and a second record only moves its image', async () => {
    await withSystemScope(db.sql, (tx) => recordCoreRelease(tx, '1.9.0', image('a')))
    await withSystemScope(db.sql, (tx) => recordCoreRelease(tx, '1.10.0', image('b')))
    await withSystemScope(db.sql, (tx) => recordCoreRelease(tx, '1.10.0', image('c')))
    const rows = await db.sql<{ version: string; kind: string }[]>`select version, kind from core_release order by version`
    expect(rows).toEqual([
      { version: '1.10.0', kind: 'minor' },
      { version: '1.9.0', kind: 'major' },
    ])
    expect(await withSystemScope(db.sql, (tx) => selectSandboxImage(tx, '1.10.0'))).toBe(image('c'))
  })

  it('names a backport by the newest version below it, not the newest of all', async () => {
    await withSystemScope(db.sql, (tx) => recordCoreRelease(tx, '2.0.0', image('e')))
    await withSystemScope(db.sql, (tx) => recordCoreRelease(tx, '1.10.1', image('f')))
    await withSystemScope(db.sql, (tx) => recordCoreRelease(tx, '1.11.0', image('a')))
    const kinds = await db.sql<{ version: string; kind: string }[]>`select version, kind from core_release where version in ('2.0.0', '1.10.1', '1.11.0') order by version`
    expect(kinds).toEqual([
      { version: '1.10.1', kind: 'patch' },
      { version: '1.11.0', kind: 'minor' },
      { version: '2.0.0', kind: 'major' },
    ])
  })

  it('names the newest version nothing has retired, or null when there is none (#902)', async () => {
    expect(await withSystemScope(db.sql, selectNewestRelease)).toBe('2.0.0')
    await withSystemScope(db.sql, (tx) => retireRelease(tx, '2.0.0', new Date()))
    expect(await withSystemScope(db.sql, selectNewestRelease)).toBe('1.11.0')
    await db.sql`update core_release set retired_at = now()`
    expect(await withSystemScope(db.sql, selectNewestRelease)).toBeNull()
    await db.sql`update core_release set retired_at = null`
  })

  it('names the version a template upload asks for only while it has an unretired row (#902)', async () => {
    const resolve = (wanted?: string) => withSystemScope(db.sql, (tx) => resolveReleasedCore(tx, wanted))
    expect(await resolve()).toBe('2.0.0')
    expect(await resolve('1.11.0')).toBe('1.11.0')
    await expect(resolve('7.7.7')).rejects.toThrow(/no unretired row for 7.7.7/)
    await withSystemScope(db.sql, (tx) => retireRelease(tx, '1.11.0', new Date()))
    await expect(resolve('1.11.0')).rejects.toThrow(/no unretired row for 1.11.0/)
    await db.sql`update core_release set retired_at = now()`
    await expect(resolve()).rejects.toThrow(/no version to upload/)
    await db.sql`update core_release set retired_at = null`
  })

  it('refuses an image that is not pinned by digest in Cloudflare’s registry', async () => {
    await expect(withSystemScope(db.sql, (tx) => recordCoreRelease(tx, '1.12.0', 'ghcr.io/dripfunnel/storefront-build:1.12.0'))).rejects.toThrow(/core_release_sandbox_image_check/)
  })

  it('is read by staff and written only by the platform’s own jobs', async () => {
    expect(((await as('app_platform', 'platform', (tx) => tx`select version from core_release`)) as unknown[]).length).toBeGreaterThan(0)
    await expect(as('app_platform', 'platform', (tx) => tx`insert into core_release (version, kind, sandbox_image) values ('9.9.9', 'major', ${image('d')})`)).rejects.toThrow(/permission denied/)
    await expect(as('app_request', 'store', (tx) => tx`select version from core_release`)).rejects.toThrow(/permission denied/)
    await expect(as('app_partner', 'partner', (tx) => tx`select version from core_release`)).rejects.toThrow(/permission denied/)
  })
})
