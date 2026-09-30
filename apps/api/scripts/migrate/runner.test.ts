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
  it(
    'applies pending migrations, records them, and no-ops on a second run',
    async () => {
      await migrate(DATABASE_URL, migrationsDir)
      const applied = await sql<{ name: string }[]>`select name from schema_migrations where name = '0001_init.sql'`
      expect(applied).toHaveLength(1)

      await expect(migrate(DATABASE_URL, migrationsDir)).resolves.toBeUndefined()
      const appliedAgain = await sql<{ name: string }[]>`select name from schema_migrations where name = '0001_init.sql'`
      expect(appliedAgain).toHaveLength(1)
    },
    20_000,
  )

  it('refuses a non-local host itself, so the test path cannot reach a real database', async () => {
    await expect(
      migrate('postgres://u:p@ep-not-the-allowed-host-999.us-east-2.aws.neon.tech:5432/db', migrationsDir),
    ).rejects.toThrow(/Refusing to run migrations/)
  })

  it('refuses a malformed connection string without leaking it', async () => {
    const secret = 'postgres://u:pa/ss@localhost:5432/db'
    try {
      await migrate(secret, migrationsDir)
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toBe('DATABASE_URL is not a valid URL.')
      expect((error as Error).message).not.toContain(secret)
    }
  })
})
