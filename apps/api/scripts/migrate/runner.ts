import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import { assertExtensionsAvailable, requiredExtensions } from './extensions'
import { pendingMigrations } from './pending'
import { assertPostgresMajor } from './version-check'

export const migrate = async (connectionString: string, migrationsDir: string): Promise<void> => {
  const sql = postgres(connectionString, { max: 1 })
  try {
    const [{ server_version_num }] = await sql<[{ server_version_num: string }]>`select current_setting('server_version_num') as server_version_num`
    assertPostgresMajor(Number(server_version_num))

    const [{ exists }] = await sql<
      [{ exists: boolean }]
    >`select exists (select 1 from information_schema.tables where table_name = 'schema_migrations') as exists`
    const applied = exists ? await sql<{ name: string }[]>`select name from schema_migrations` : []
    const pending = pendingMigrations(readdirSync(migrationsDir), new Set(applied.map((row) => row.name)))
    const withContents = pending.map((name) => ({ name, contents: readFileSync(path.join(migrationsDir, name), 'utf8') }))

    await assertExtensionsAvailable(
      sql,
      requiredExtensions(withContents.map((m) => m.contents)),
    )

    for (const { name, contents } of withContents) {
      await sql.begin(async (tx) => {
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
