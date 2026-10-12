import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from './support/database'

// ST 0 (#486): a storefront_template row for every starting theme, equal to its template.json (DATA-MODEL §7.8).

let db: TestDatabase
const themes = fileURLToPath(new URL('../../../templates/storefront/themes/', import.meta.url))

beforeAll(async () => {
  db = await createTestDatabase()
})

afterAll(async () => {
  await db.drop()
})

const as = (role: string, scope: string, work: (tx: postgres.TransactionSql) => Promise<unknown>) =>
  db.sql.begin(async (tx: postgres.TransactionSql) => {
    await tx.unsafe(`set local role ${role}`)
    await tx`select set_config('app.scope', ${scope}, true)`
    return work(tx)
  })

describe('storefront_template', () => {
  it('has a row for each theme in templates/storefront/themes, offered, with the words of its template.json', async () => {
    const files = readdirSync(themes).map((key) => JSON.parse(readFileSync(`${themes}${key}/template.json`, 'utf8')) as Record<string, unknown>)
    const rows = await db.sql`select key, name, tag, description, demo_store_id, core_min_version, state from storefront_template order by key`
    expect(rows).toEqual(
      files
        .map((t) => ({ key: t['key'], name: t['name'], tag: t['tag'], description: t['description'], demo_store_id: t['demoStore'], core_min_version: t['coreMinVersion'], state: 'offered' }))
        .sort((a, b) => String(a.key).localeCompare(String(b.key))),
    )
  })

  it('is read by staff and written only by the platform’s own jobs', async () => {
    expect(((await as('app_platform', 'platform', (tx) => tx`select key from storefront_template`)) as unknown[]).length).toBeGreaterThan(0)
    await expect(as('app_platform', 'platform', (tx) => tx`update storefront_template set state = 'retired'`)).rejects.toThrow(/permission denied/)
    await expect(as('app_request', 'store', (tx) => tx`select key from storefront_template`)).rejects.toThrow(/permission denied/)
    await expect(as('app_partner', 'partner', (tx) => tx`select key from storefront_template`)).rejects.toThrow(/permission denied/)
  })

  it('is written by the system scope, and each role sees nothing outside its own scope', async () => {
    const rollback = new Error('rollback')
    await expect(
      as('app_system', 'system', async (tx) => {
        await tx`insert into storefront_template (key, name, tag, description, core_min_version) values ('zz-test', 'Test', 'Test', 'A test template.', '0.0.0')`
        const [row] = await tx`update storefront_template set state = 'retired' where key = 'zz-test' returning state`
        expect(row?.['state']).toBe('retired')
        throw rollback
      }),
    ).rejects.toBe(rollback)

    expect(await as('app_platform', 'store', (tx) => tx`select key from storefront_template`)).toHaveLength(0)
    expect(await as('app_system', 'store', (tx) => tx`select key from storefront_template`)).toHaveLength(0)
    await expect(
      as('app_system', 'store', (tx) => tx`insert into storefront_template (key, name, tag, description, core_min_version) values ('zz-test', 'Test', 'Test', 'A test template.', '0.0.0')`),
    ).rejects.toThrow(/row-level security/)
  })
})
