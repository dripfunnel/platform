import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../scripts/migrate/runner'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #177: the runner applies migrations as the owner of the schema's tables, and says who
// owns them when it cannot (DATA-MODEL.md §5.3).

const owner = 'df_owner_test'
let db: TestDatabase
let superuser = false

const migrationWith = (name: string, sql: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'df-migrate-'))
  writeFileSync(path.join(dir, name), sql)
  return dir
}

beforeAll(async () => {
  db = await createTestDatabase()
  const [me] = await db.sql<{ rolsuper: boolean }[]>`select rolsuper from pg_roles where rolname = current_user`
  superuser = me?.rolsuper ?? false
  // The role is cluster-wide, so it is created once and left in place for the next run.
  await db.sql.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${owner}') then create role "${owner}" nologin; end if; end $$`)
  await db.sql`grant usage, create on schema public to ${db.sql(owner)}`
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('migrations run as the owner of the schema', () => {
  it('a member of the owner applies a migration as the owner, so the new table is the owner’s too', async () => {
    const tables = await db.sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = current_schema()`
    for (const { tablename } of tables) await db.sql`alter table ${db.sql(tablename)} owner to ${db.sql(owner)}`
    await db.sql`grant ${db.sql(owner)} to current_user`

    await migrate(db.url, migrationWith('9001_owner_probe.sql', 'create table owner_probe (id int primary key);'))

    const [probe] = await db.sql<{ tableowner: string }[]>`select tableowner from pg_tables where tablename = 'owner_probe'`
    expect(probe?.tableowner).toBe(owner)
    expect(await db.sql`select name from schema_migrations where name = '9001_owner_probe.sql'`).toHaveLength(1)
  })

  it('refuses tables with more than one owner by name, before anything runs', async () => {
    await db.sql`alter table owner_probe owner to current_user`
    await expect(migrate(db.url, migrationWith('9002_never.sql', 'create table never_made (id int);'))).rejects.toThrow(/owned by df_owner_test, \w+; migrations need one owner/)
    expect(await db.sql`select 1 from pg_tables where tablename = 'never_made'`).toHaveLength(0)
    await db.sql`alter table owner_probe owner to ${db.sql(owner)}`
  })

  // A superuser is a member of every role, so only a plain role can be refused; known once the
  // database exists, hence the skip at run time.
  it('refuses a role that is neither the owner nor a member, naming both and the grant', async ({ skip }) => {
    if (superuser) skip()
    await db.sql`revoke ${db.sql(owner)} from current_user`
    await expect(migrate(db.url, migrationWith('9003_never.sql', 'create table never_made (id int);'))).rejects.toThrow(
      new RegExp(`Connected as \\w+, but the tables are owned by ${owner}.*grant "${owner}" to`),
    )
    expect(await db.sql`select 1 from pg_tables where tablename = 'never_made'`).toHaveLength(0)
    await db.sql`grant ${db.sql(owner)} to current_user`
  })
})
