import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import { assertExtensionsAvailable, requiredExtensions } from './extensions'
import { assertLocalHost } from './host-guard'
import { checkOwner, setRoleStatement } from './owner'
import { pendingMigrations } from './pending'
import { assertPostgresMajor } from './version-check'

const LOCK_KEY = 'dripfunnel_migrations'

export const migrate = async (connectionString: string, migrationsDir: string): Promise<void> => {
  // The guard belongs here, not only in main.ts, so every caller of migrate() — CLI or
  // test — passes through it.
  assertLocalHost(connectionString)

  let sql: postgres.Sql
  try {
    sql = postgres(connectionString, { max: 1 })
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.')
  }
  try {
    const [{ server_version_num }] = await sql<[{ server_version_num: string }]>`select current_setting('server_version_num') as server_version_num`
    assertPostgresMajor(Number(server_version_num))

    await sql`select pg_advisory_lock(hashtext(${LOCK_KEY}))`
    const [{ exists }] = await sql<[{ exists: boolean }]>`select exists (
      select 1 from information_schema.tables where table_schema = current_schema() and table_name = 'schema_migrations'
    ) as exists`
    const applied = exists ? await sql<{ name: string }[]>`select name from schema_migrations` : []
    const pending = pendingMigrations(readdirSync(migrationsDir), new Set(applied.map((row) => row.name)))
    const withContents = pending.map((name) => ({ name, contents: readFileSync(path.join(migrationsDir, name), 'utf8') }))

    await assertExtensionsAvailable(
      sql,
      requiredExtensions(withContents.map((m) => m.contents)),
    )

    // Checked even with nothing pending, so a wrong role is reported on every run, not only
    // on the one that happens to carry a migration.
    const owner = await checkOwner(sql)
    const setRole = setRoleStatement(owner)
    if (setRole) console.log(`Connected as ${owner.connectedAs}; applying migrations as the owner, ${owner.runAs}.`)

    for (const { name, contents } of withContents) {
      await sql.begin(async (tx) => {
        if (setRole) await tx.unsafe(setRole)
        await tx.unsafe(contents)
        await tx`insert into schema_migrations (name) values (${name})`
      })
      console.log(`Applied ${name}`)
    }
    if (pending.length === 0) console.log('No pending migrations.')
  } finally {
    await sql.end()
  }
}
