import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// The Worker's crons (#477) against a real database: each runs its own group cleanly, and only the daily one purges carts.

let db: TestDatabase
let t: Tenants

const env = () => ({
  ADMIN_HOST: 'admin.dripfunnel.com',
  PLATFORM_HOST: 'platform.dripfunnel.com',
  HOOKS_HOST: 'hooks.dripfunnel.com',
  HYPERDRIVE: { connectionString: db.url },
  CF_VERSION_METADATA: { id: 'test', tag: '' },
})

const run = async (cron: string): Promise<string[]> => {
  const lines: string[] = []
  const log = console.log
  console.log = (line: string) => void lines.push(line)
  try {
    await worker.scheduled({ cron } as never, env() as never)
  } finally {
    console.log = log
  }
  return lines.map((l) => (JSON.parse(l) as { event: string }).event)
}

const expiredCarts = async (): Promise<number> =>
  Number((await db.sql<{ n: string }[]>`select count(*)::text as n from "order" where store_id = ${t.storeA1} and state = 'cart' and cart_expires_at < now()`)[0]?.n)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the crons', () => {
  it('each runs its group against a real database without a failure', async () => {
    for (const cron of ['* * * * *', '*/5 * * * *', '0 * * * *', '0 3 * * *']) expect((await run(cron)).filter((e) => e.endsWith('_failed') || e === 'relay_skipped')).toEqual([])
  })

  it('leaves expired carts to the daily run, which deletes past one batch of them', async () => {
    await db.sql`
      insert into "order" (store_id, currency, access_token_hash, cart_expires_at)
      select ${t.storeA1}, 'INR', encode(sha256((g::text || ${crypto.randomUUID()})::bytea), 'hex'), now() - interval '1 day' from generate_series(1, 600) g
    `
    for (const cron of ['* * * * *', '*/5 * * * *', '0 * * * *']) await run(cron)
    expect(await expiredCarts()).toBe(600)
    await run('0 3 * * *')
    expect(await expiredCarts()).toBe(0)
  })
})
