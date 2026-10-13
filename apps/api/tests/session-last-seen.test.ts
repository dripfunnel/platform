import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPartnerSession, readPartnerSession } from '#auth/partnerSession'
import { createSession, hashSessionId, lastSeenWriteMs, readSession } from '#auth/session'
import { createUserSession, readUserSession } from '#auth/storeSession'
import type { ScopedSql } from '#db/scoped/index'
import { withSystemScope } from '#db/scoped/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants } from './support/fixtures'

// Card #636: a read writes `last_seen_at` at most once a minute (ACCESS.md §4), so it holds no row lock otherwise.

let db: TestDatabase
let staffUserId: string
let partnerUserId: string
let userId: string
let partnerId: string

const start = new Date('2026-10-13T09:00:00Z')
const at = (ms: number) => new Date(start.getTime() + ms)

interface Pool {
  table: 'staff_session' | 'partner_session' | 'user_session'
  create: (tx: ScopedSql, now: Date) => Promise<string>
  read: (tx: ScopedSql, id: string, now: Date) => Promise<unknown>
}

const pools: Pool[] = [
  { table: 'staff_session', create: (tx, now) => createSession(tx, staffUserId, now), read: readSession },
  { table: 'partner_session', create: (tx, now) => createPartnerSession(tx, partnerUserId, now), read: readPartnerSession },
  {
    table: 'user_session',
    create: (tx, now) => createUserSession(tx, { id: userId, partnerId }, now),
    read: (tx, id, now) => readUserSession(tx, id, partnerId, now),
  },
]

beforeAll(async () => {
  db = await createTestDatabase()
  partnerId = (await seedTenants(db.sql)).partnerA
  const [staff] = await db.sql<{ id: string }[]>`
    insert into staff_user (sso_subject, email, name, role_key, status)
    values ('subject-636', 'priya@softobotics.com', 'Priya', 'staff-read-only', 'active') returning id`
  const [partnerUser] = await db.sql<{ id: string }[]>`
    insert into partner_user (partner_id, email, name, role_key, status)
    values (${partnerId}, 'asha@partner-a.example', 'Asha', 'partner-owner', 'active') returning id`
  const [user] = await db.sql<{ id: string }[]>`
    insert into "user" (partner_id, email, name, status, password_hash)
    values (${partnerId}, 'ravi@store-a.example', 'Ravi', 'active', 'x') returning id`
  if (!staff || !partnerUser || !user) throw new Error('fixture insert returned no row')
  staffUserId = staff.id
  partnerUserId = partnerUser.id
  userId = user.id
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe.each(pools)('$table', (pool) => {
  const lastSeen = async (id: string): Promise<number | undefined> => {
    const [row] = await db.sql<{ last_seen_at: Date }[]>`
      select last_seen_at from ${db.sql(pool.table)} where id_hash = ${await hashSessionId(id)}`
    return row?.last_seen_at.getTime()
  }

  it('leaves last_seen_at alone under a minute after it, and moves it to the read at a minute or more', async () => {
    const id = await withSystemScope(db.sql, (tx) => pool.create(tx, start))

    expect(await withSystemScope(db.sql, (tx) => pool.read(tx, id, at(lastSeenWriteMs - 1)))).not.toBeNull()
    expect(await lastSeen(id)).toBe(start.getTime())

    expect(await withSystemScope(db.sql, (tx) => pool.read(tx, id, at(lastSeenWriteMs)))).not.toBeNull()
    expect(await lastSeen(id)).toBe(at(lastSeenWriteMs).getTime())

    expect(await withSystemScope(db.sql, (tx) => pool.read(tx, id, at(lastSeenWriteMs + 30_000)))).not.toBeNull()
    expect(await lastSeen(id)).toBe(at(lastSeenWriteMs).getTime())
  })

  it('is read on a second connection without waiting while a first read is still uncommitted', async () => {
    const id = await withSystemScope(db.sql, (tx) => pool.create(tx, start))

    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let firstRead: () => void = () => {}
    const firstHasRead = new Promise<void>((resolve) => {
      firstRead = resolve
    })
    const first = withSystemScope(db.sql, async (tx) => {
      const session = await pool.read(tx, id, at(10_000))
      firstRead()
      await held
      return session
    })

    try {
      await firstHasRead
      // A regression to a write on every read would block here on the first's row lock; this fails it instead.
      const second = await withSystemScope(db.sql, async (tx) => {
        await tx`set local lock_timeout = '1s'`
        return pool.read(tx, id, at(20_000))
      })
      expect(second).not.toBeNull()
    } finally {
      release()
    }
    expect(await first).not.toBeNull()
  })
})
