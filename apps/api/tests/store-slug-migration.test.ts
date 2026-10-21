import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../scripts/migrate/runner'
import { createTestDatabase, type TestDatabase } from './support/database'

// 0354 (#744: store.slug) and 0355 (#745: the shops address retired), each run over rows the build before it made.

const source = fileURLToPath(new URL('../migrations', import.meta.url))
const staged = mkdtempSync(path.join(tmpdir(), 'df-migrations-'))
let base: TestDatabase
let url = ''
let sql: postgres.Sql

const stage = (last: string) => {
  for (const name of readdirSync(source).filter((n) => n.endsWith('.sql') && n <= last)) copyFileSync(path.join(source, name), path.join(staged, name))
}
const admin = () => postgres(new URL('/postgres', base.url).toString(), { max: 1 })

beforeAll(async () => {
  // Only for its name, its host and its sweep of abandoned databases: the migrations here run in a database of their own, step by step.
  base = await createTestDatabase()
  const a = admin()
  await a.unsafe(`create database "${base.name}_staged"`)
  await a.end()
  const staged_url = new URL(base.url)
  staged_url.pathname = `/${base.name}_staged`
  url = staged_url.toString()
  stage('0353_branding_setup_session.sql')
  await migrate(url, staged)
  sql = postgres(url, { max: 2, fetch_types: false })
}, 180_000)

afterAll(async () => {
  await sql?.end()
  const a = admin()
  await a.unsafe(`drop database if exists "${base.name}_staged"`)
  await a.end()
  await base?.drop()
  rmSync(staged, { recursive: true, force: true })
})

const idOf = async (query: Promise<postgres.RowList<{ id: string }[]>>) => (await query)[0]?.id ?? ''

describe('0354 and 0355 over the rows the build before them made', () => {
  const partners: Record<'a' | 'b', string> = { a: '', b: '' }

  it('0354 gives two stores with one code under different partners distinct slugs, oldest first, and no reserved or -preview one', async () => {
    partners.a = await idOf(sql<{ id: string }[]>`insert into partner (name) values ('Old A') returning id`)
    partners.b = await idOf(sql<{ id: string }[]>`insert into partner (name) values ('Old B') returning id`)
    await sql`insert into store (partner_id, name, code, created_at) values (${partners.b}, 'Second', 'twin', now() - interval '1 day'), (${partners.a}, 'First', 'twin', now() - interval '2 days')`
    await sql`insert into store (partner_id, name, code) values (${partners.a}, 'Shop', 'shop'), (${partners.a}, 'Preview', 'acme-preview'), (${partners.a}, 'Mixed', 'mixed-case')`
    stage('0354_store_slug.sql')
    await migrate(url, staged)
    const slugs = await sql<{ code: string; partner_id: string; slug: string }[]>`select code, partner_id, slug from store order by created_at, id`
    const twins = slugs.filter((s) => s.code === 'twin')
    expect(twins.map((s) => [s.partner_id === partners.a, s.slug])).toEqual([[true, 'twin'], [false, 'twin-2']])
    expect(slugs.find((s) => s.code === 'shop')?.slug).toBe('shop-store')
    expect(slugs.find((s) => s.code === 'acme-preview')?.slug).toBe('acme-preview-store')
    expect(slugs.every((s) => /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s.slug) && !s.slug.endsWith('-preview'))).toBe(true)
    expect(new Set(slugs.map((s) => s.slug)).size).toBe(slugs.length)
  })

  it('0355 queues one domain.remove per host #519 could have registered, deletes every shops row, record and wildcards item, and narrows the checks', async () => {
    // Rows as the build before 0355 left them: partner A's shops address live, partner B's still waiting, and one queued store_host.sync.
    await sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${partners.a}, 'shops', '*.shops.olda.example', 'live', 'CNAME', 'x'), (${partners.b}, 'shops', '*.shops.oldb.example', 'waiting', 'CNAME', 'x'), (${partners.a}, 'portal', 'store.olda.example', 'live', 'CNAME', 'x')`
    await sql`insert into partner_domain_record (domain_id, partner_id, position, purpose, record_type, name, expected)
      select id, partner_id, 0, 'pointer', 'CNAME', 'df-probe.shops.olda.example', 'x' from partner_domain where kind = 'shops'`
    await sql`insert into partner_setup_item (partner_id, item, status) values (${partners.a}, 'wildcards', 'missing'), (${partners.a}, 'portalHost', 'missing')`
    await sql`insert into outbox (kind, idempotency_key, payload) values ('store_host.sync', 'store_host.sync:pending', '{}'), ('store_hosts.register', 'store_hosts.register:pending', '{}')`
    stage('0355_retire_shops_address.sql')
    await migrate(url, staged)
    const queued = await sql<{ host: string }[]>`select payload->>'host' as host from outbox where kind = 'domain.remove' order by 1`
    // Partner B's address never got past waiting, so none of its stores' hosts was registered.
    expect(queued.map((q) => q.host)).toEqual(['acme-preview.shops.olda.example', 'mixed-case.shops.olda.example', 'shop.shops.olda.example', 'twin.shops.olda.example'])
    expect(await sql`select 1 from partner_domain where kind = 'shops'`).toEqual([])
    expect(await sql`select 1 from partner_domain_record r left join partner_domain d on d.id = r.domain_id where d.id is null or d.kind = 'shops'`).toEqual([])
    expect(await sql`select item from partner_setup_item where partner_id = ${partners.a}`).toEqual([{ item: 'portalHost' }])
    expect(await sql`select 1 from outbox where kind in ('store_host.sync', 'store_hosts.register') and delivered_at is null`).toEqual([])
    expect(await sql`select kind from partner_domain`).toEqual([{ kind: 'portal' }])
    await expect(sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${partners.b}, 'shops', '*.x.example', 'waiting', 'CNAME', 'x')`).rejects.toThrow(/partner_domain_kind_check/)
    await expect(sql`insert into partner_setup_item (partner_id, item, status) values (${partners.b}, 'wildcards', 'missing')`).rejects.toThrow(/partner_setup_item_item_check/)
  })
})
