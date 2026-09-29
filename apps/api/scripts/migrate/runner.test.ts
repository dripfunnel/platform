import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { migrate } from './runner'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel'
const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url))
const sql = postgres(DATABASE_URL, { max: 1 })

afterAll(async () => {
  await sql.end()
})

describe('migrate', () => {
  it('applies pending migrations, records them, and no-ops on a second run', async () => {
    await migrate(DATABASE_URL, migrationsDir)
    const applied = await sql<{ name: string }[]>`select name from schema_migrations where name = '0001_init.sql'`
    expect(applied).toHaveLength(1)

    await expect(migrate(DATABASE_URL, migrationsDir)).resolves.toBeUndefined()
    const appliedAgain = await sql<{ name: string }[]>`select name from schema_migrations where name = '0001_init.sql'`
    expect(appliedAgain).toHaveLength(1)
  })
})
