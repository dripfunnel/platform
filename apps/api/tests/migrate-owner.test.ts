import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../scripts/migrate/runner'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #177: the runner applies migrations as the owner of the schema's tables, and says who
// owns them when it cannot (DATA-MODEL.md §5.3).

const owner = 'df_owner_test'
// A plain login role, a member of nothing, so the refusal is exercised whatever the local role is.
const outsider = 'df_outsider_test'
const outsiderPassword = randomUUID().replaceAll('-', '')
let db: TestDatabase

const migrationWith = (name: string, sql: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'df-migrate-'))
  writeFileSync(path.join(dir, name), sql)
  return dir
}

beforeAll(async () => {
  db = await createTestDatabase()
  // Roles are cluster-wide, so they are created once and left in place for the next run.
  await db.sql.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${owner}') then create role "${owner}" nologin; end if; end $$`)
  await db.sql.unsafe(
    `do $$ begin if not exists (select 1 from pg_roles where rolname = '${outsider}') then create role "${outsider}" login password '${outsiderPassword}'; else alter role "${outsider}" with login password '${outsiderPassword}'; end if; end $$`,
  )
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

  it('refuses a role that is neither the owner nor a member, naming both and the grant', async () => {
    const url = new URL(db.url)
    url.username = outsider
    url.password = outsiderPassword
    await expect(migrate(url.toString(), migrationWith('9003_never.sql', 'create table never_made (id int);'))).rejects.toThrow(
      `Connected as ${outsider}, but the tables are owned by ${owner}, so no migration can run. Either grant the membership (grant "${owner}" to "${outsider}") or connect as ${owner}.`,
    )
    expect(await db.sql`select 1 from pg_tables where tablename = 'never_made'`).toHaveLength(0)
  })
})
