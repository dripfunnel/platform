import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// The Worker's crons (#477) against a real database: each runs its own group cleanly, and each purge waits for its own cadence.

let db: TestDatabase
let t: Tenants

const env = () => ({
  ADMIN_HOST: 'admin.dripfunnel.ai',
  PLATFORM_HOST: 'platform.dripfunnel.ai',
  HOOKS_HOST: 'hooks.dripfunnel.ai',
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

  it('purges expired sign-up texts past one batch hourly, though no sign-up is due with them', async () => {
    const texts = async () => Number((await db.sql<{ n: string }[]>`select count(*)::text as n from signup_text where partner_id = ${t.partnerA}`)[0]?.n)
    await db.sql`
      insert into signup_text (partner_id, phone, sent_at)
      select ${t.partnerA}, '+15550100' || g::text, now() - interval '2 days' from generate_series(1, 600) g
    `
    await run('*/5 * * * *')
    expect(await texts()).toBe(600)
    await run('0 * * * *')
    expect(await texts()).toBe(0)
  })
})
