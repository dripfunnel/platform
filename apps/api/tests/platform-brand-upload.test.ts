import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleBrandUpload } from '#apis/platform/uploads'
import { createPartnerSession, partnerCookieName } from '#auth/partnerSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import type { BrandFileStore } from '#saas/partnerBranding/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #219: brand file uploads under the partner's own prefix.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-03T09:00:00Z')
const host = 'platform.dripfunnel.com'
const stored = new Map<string, { bytes: Uint8Array; contentType: string }>()
const store: BrandFileStore = {
  put: async (key, value, options) => {
    stored.set(key, { bytes: value, contentType: options.httpMetadata.contentType })
  },
}
const cookies = { admin: '', reader: '' }
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])

const upload = (body: BodyInit, cookie: string | null, kind = 'logoLight', withStore = true) =>
  handleBrandUpload(
    new Request(`https://${host}/api/uploads/brand-file?kind=${kind}`, {
      method: 'POST',
      body,
      headers: { origin: `https://${host}`, 'content-type': 'image/png', ...(cookie ? { cookie: `${partnerCookieName}=${cookie}` } : {}) },
    }),
    { sql: db.sql, activity: activityLog, store: withStore ? store : null, now: () => now },
  )

const userIn = async (role: string) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into partner_user (partner_id, email, name, role_key, status) values (${t.partnerA}, ${`${role}@northstar.example`}, ${role}, ${role}, 'active') returning id`
  return withSystemScope(db.sql, (tx) => createPartnerSession(tx, row?.id ?? '', now))
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  cookies.admin = await userIn('partner-admin')
  cookies.reader = await userIn('partner-read-only')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('brand file upload', () => {
  it('stores a good file under the caller’s own prefix by its sniffed type, and logs it', async () => {
    const response = await upload(png, cookies.admin)
    const body = (await response.json()) as { ok: boolean; key: string }
    expect(response.status).toBe(200)
    expect(body.key).toMatch(new RegExp(`^partners/${t.partnerA}/brand/[0-9a-f-]{36}\\.png$`))
    expect(stored.get(body.key)?.contentType).toBe('image/png')
    const [entry] = await db.sql`select action, target_id, target_label from activity_log where action = 'branding.file_uploaded'`
    expect(entry).toMatchObject({ target_id: body.key, target_label: 'logoLight' })
  })

  it('refuses no session, a role without branding.write, a wrong kind, no bucket, too large, the wrong type and a scripted SVG', async () => {
    const before = stored.size
    const answer = async (r: Promise<Response>) => {
      const response = await r
      return [response.status, ((await response.json()) as { code: string }).code]
    }
    expect(await answer(upload(png, null))).toEqual([401, 'UNAUTHENTICATED'])
    expect(await answer(upload(png, 'not-a-session'))).toEqual([401, 'UNAUTHENTICATED'])
    expect(await answer(upload(png, cookies.reader))).toEqual([403, 'FORBIDDEN'])
    expect(await answer(upload(png, cookies.admin, 'banner'))).toEqual([400, 'INVALID_KIND'])
    expect(await answer(upload(png, cookies.admin, 'logoLight', false))).toEqual([503, 'NOT_CONNECTED'])
    const big = new Uint8Array(512 * 1024 + 1)
    big.set(png)
    expect(await answer(upload(big, cookies.admin))).toEqual([413, 'TOO_LARGE'])
    expect(await answer(upload(new TextEncoder().encode('GIF89a'), cookies.admin))).toEqual([415, 'UNSUPPORTED_TYPE'])
    expect(await answer(upload('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', cookies.admin, 'mark'))).toEqual([415, 'UNSAFE_SVG'])
    expect(stored.size).toBe(before)
  })
})
