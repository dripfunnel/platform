import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../scripts/migrate/runner'
import { seedTenants } from './support/fixtures'

// Migration 0370 on a database that already ran 0369 (rows written by the previous release), as well as the fresh path every
// other suite takes: existing keys stay keys, and nothing is lost.

const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
const adminUrl = process.env.DATABASE_URL ?? 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel'
const name = `dripfunnel_test_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`
const urlOf = (database: string) => {
  const url = new URL(adminUrl)
  url.pathname = `/${database}`
  return url.toString()
}
let sql: postgres.Sql
let upTo0369: string

beforeAll(async () => {
  const admin = postgres(adminUrl, { max: 1 })
  await admin.unsafe(`create database "${name}"`)
  await admin.end()
  upTo0369 = mkdtempSync(path.join(tmpdir(), 'migrations-0369-'))
  for (const file of readdirSync(migrations).filter((f) => f < '0370')) cpSync(path.join(migrations, file), path.join(upTo0369, file))
  await migrate(urlOf(name), upTo0369)
  sql = postgres(urlOf(name), { max: 2, fetch_types: false })
}, 120_000)

afterAll(async () => {
  await sql?.end()
  rmSync(upTo0369, { recursive: true, force: true })
  const admin = postgres(adminUrl, { max: 1 })
  await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${name} and pid <> pg_backend_pid()`
  await admin.unsafe(`drop database if exists "${name}"`)
  await admin.end()
})

describe('migration 0370', () => {
  it('keeps what 0369 and the previous release wrote, as API keys', async () => {
    const t = await seedTenants(sql)
    await sql`insert into store_ai_account (store_id, provider, key_enc, key_prefix, status, connected_by) values (${t.storeA1}, 'openai', 'v1.x.y', 'sk-…1234', 'ok', 'Olivia')`
    await sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, status, is_default, created_by) values (${t.partnerA}, 'ai', 'anthropic', 'Default', 'v1.x.y', 'sk-ant-…x7Qd', 'ok', true, 'Maya')`
    await sql`insert into ai_run (store_id, kind, prompt, model, tokens_in, tokens_out, cost_amount, cost_currency, billed_to, outcome, provider) values (${t.storeA1}, 'gateway', '', 'gpt-5', 1, 1, 1, 'USD', 'own_key', 'changed', 'openai')`
    await migrate(urlOf(name), migrations)
    expect(await sql`select auth_type, account_label, key_enc from store_ai_account`).toEqual([{ auth_type: 'api_key', account_label: null, key_enc: 'v1.x.y' }])
    expect(await sql`select auth_type, account_label from partner_credential`).toEqual([{ auth_type: 'api_key', account_label: null }])
    expect(await sql`select auth_method from ai_run`).toEqual([{ auth_method: 'api_key' }])
  })

  it('is applied once and a second run changes nothing', async () => {
    await migrate(urlOf(name), migrations)
    expect((await sql<{ n: string }[]>`select count(*) as n from schema_migrations where name like '0370%'`)[0]?.n).toBe('1')
  })

  it('refuses an unknown auth type and keeps attempts out of every request role', async () => {
    await expect(sql`update store_ai_account set auth_type = 'cookie'`).rejects.toThrow(/auth_type/)
    const roles = await sql<{ role: string; allowed: boolean }[]>`
      select r as role, has_table_privilege(r, 'ai_oauth_attempt', 'select') as allowed from unnest(array['app_request', 'app_partner', 'app_platform', 'app_shop']) as r`
    expect(roles.every((r) => !r.allowed)).toBe(true)
  })
})
