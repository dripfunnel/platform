import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isAssigned } from '#auth/assignment'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

let db: TestDatabase
let tenants: Tenants
let manager: string
const nowhere = '00000000-0000-4000-8000-000000000000'

beforeAll(async () => {
  db = await createTestDatabase()
  tenants = await seedTenants(db.sql)
  const [row] = await db.sql<{ id: string }[]>`
    insert into staff_user (sso_subject, email, name, role_key, status)
    values ('subject-pm', 'pm@softobotics.com', 'Pat', 'staff-partner-manager', 'active') returning id
  `
  if (!row) throw new Error('fixture insert returned no row')
  manager = row.id
  await db.sql`insert into staff_partner_assignment (staff_user_id, partner_id) values (${manager}, ${tenants.partnerA})`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('a Partner manager assigned to partner A', () => {
  it('reaches partner A and its stores', async () => {
    expect(await isAssigned(db.sql, manager, { partnerId: tenants.partnerA })).toBe(true)
    expect(await isAssigned(db.sql, manager, { storeId: tenants.storeA1 })).toBe(true)
  })

  it('reaches neither partner B nor its stores', async () => {
    expect(await isAssigned(db.sql, manager, { partnerId: tenants.partnerB })).toBe(false)
    expect(await isAssigned(db.sql, manager, { storeId: tenants.storeB1 })).toBe(false)
  })

  it('gets the same answer for a target that does not exist, or is not an id at all', async () => {
    expect(await isAssigned(db.sql, manager, { partnerId: nowhere })).toBe(false)
    expect(await isAssigned(db.sql, manager, { storeId: nowhere })).toBe(false)
    expect(await isAssigned(db.sql, manager, { partnerId: 'not-an-id' })).toBe(false)
  })
})

describe('the assignment table', () => {
  const asScope = (scope: string) =>
    db.sql.begin(async (tx) => {
      await tx`set local role app_request`
      await tx`select set_config('app.scope', ${scope}, true)`
      await tx`select set_config('app.partner_id', ${tenants.partnerA}, true)`
      await tx`select set_config('app.store_id', ${tenants.storeA1}, true)`
      return tx`select partner_id from staff_partner_assignment`
    })

  it('is read in platform scope only, never by a partner or a store', async () => {
    expect(await asScope('platform')).toHaveLength(1)
    expect(await asScope('partner')).toHaveLength(0)
    expect(await asScope('store')).toHaveLength(0)
  })

  it('is written by no request scope', async () => {
    await expect(
      db.sql.begin(async (tx) => {
        await tx`set local role app_request`
        await tx`select set_config('app.scope', 'platform', true)`
        return tx`insert into staff_partner_assignment (staff_user_id, partner_id) values (${manager}, ${tenants.partnerB})`
      }),
    ).rejects.toThrow(/permission denied/i)
  })
})
