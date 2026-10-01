import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { migrate } from '../../scripts/migrate/runner'

// A database per run on the local Postgres (docs/api/README.md §7), dropped afterwards. The
// prefix is how the next run finds one a crashed run left behind.
const prefix = 'dripfunnel_test_'

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url))

const defaultUrl = 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel'

const adminUrl = (): string => process.env.DATABASE_URL ?? defaultUrl

const urlForDatabase = (name: string): string => {
  const url = new URL(adminUrl())
  url.pathname = `/${name}`
  return url.toString()
}

/** Sweep databases a crashed run left behind, leaving alone any a live run is using. */
const staleAfterMs = 30 * 60 * 1000

const createdAt = (name: string): number => Number.parseInt(name.slice(prefix.length).split('_')[0] ?? '', 36)

const dropAbandoned = async (admin: postgres.Sql): Promise<void> => {
  const candidates = await admin<{ datname: string }[]>`
    select datname from pg_database
    where datname like ${`${prefix}%`}
      and not exists (select 1 from pg_stat_activity where pg_stat_activity.datname = pg_database.datname)
  `
  // Not by connections alone: a run that has just created its database has not connected to
  // it yet, and a concurrent run would drop it out from under them.
  const now = Date.now()
  const abandoned = candidates.filter(({ datname }) => {
    const created = createdAt(datname)
    return Number.isFinite(created) && now - created > staleAfterMs
  })
  for (const { datname } of abandoned) {
    // Identifiers cannot be parameterised; this name came from pg_database, not from input.
    await admin.unsafe(`drop database if exists "${datname}"`)
  }
}

export interface TestDatabase {
  sql: postgres.Sql
  url: string
  name: string
  drop: () => Promise<void>
}

/** A migrated database of this run's own. Call `drop()` in `afterAll`. */
export const createTestDatabase = async (): Promise<TestDatabase> => {
  // The timestamp is what lets an abandoned database be aged.
  const name = `${prefix}${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`
  const admin = postgres(adminUrl(), { max: 1 })
  try {
    await dropAbandoned(admin)
    await admin.unsafe(`create database "${name}"`)
  } finally {
    await admin.end()
  }

  const url = urlForDatabase(name)
  await migrate(url, migrationsDir)

  const sql = postgres(url, { max: 4 })
  return {
    sql,
    url,
    name,
    drop: async () => {
      await sql.end()
      const cleanup = postgres(adminUrl(), { max: 1 })
      try {
        // An open connection would make the drop hang.
        await cleanup`
          select pg_terminate_backend(pid) from pg_stat_activity
          where datname = ${name} and pid <> pg_backend_pid()
        `
        await cleanup.unsafe(`drop database if exists "${name}"`)
      } finally {
        await cleanup.end()
      }
    },
  }
}
