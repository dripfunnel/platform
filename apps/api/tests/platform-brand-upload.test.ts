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
const cookies = { admin: '', reader: '', adminB: '' }
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const tooBig = () => {
  const big = new Uint8Array(512 * 1024 + 1)
  big.set(png)
  return big
}

const brandRequest = (body: BodyInit, cookie: string | null, query = 'kind=logoLight') =>
  new Request(`https://${host}/api/uploads/brand-file?${query}`, {
    method: 'POST',
    body,
    headers: { origin: `https://${host}`, 'content-type': 'image/png', ...(cookie ? { cookie: `${partnerCookieName}=${cookie}` } : {}) },
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  })

const send = (request: Request, withStore: BrandFileStore | null = store) => handleBrandUpload(request, { sql: db.sql, activity: activityLog, store: withStore, now: () => now })

const upload = (body: BodyInit, cookie: string | null, kind = 'logoLight', withStore = true) => send(brandRequest(body, cookie, `kind=${kind}`), withStore ? store : null)

const answer = async (r: Promise<Response>) => {
  const response = await r
  return [response.status, ((await response.json()) as { code: string }).code]
}

const logged = async (partnerId: string) => {
  const [row] = await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where action = 'branding.file_uploaded' and partner_id = ${partnerId}`
  return row?.n ?? 0
}

const userIn = async (partnerId: string, role: string, email: string) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into partner_user (partner_id, email, name, role_key, status) values (${partnerId}, ${email}, ${role}, ${role}, 'active') returning id`
  return withSystemScope(db.sql, (tx) => createPartnerSession(tx, row?.id ?? '', now))
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  cookies.admin = await userIn(t.partnerA, 'partner-admin', 'admin@northstar.example')
  cookies.reader = await userIn(t.partnerA, 'partner-read-only', 'reader@northstar.example')
  cookies.adminB = await userIn(t.partnerB, 'partner-admin', 'admin@southwind.example')
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
    expect(await answer(upload(png, null))).toEqual([401, 'UNAUTHENTICATED'])
    expect(await answer(upload(png, 'not-a-session'))).toEqual([401, 'UNAUTHENTICATED'])
    expect(await answer(upload(png, cookies.reader))).toEqual([403, 'FORBIDDEN'])
    expect(await answer(upload(png, cookies.admin, 'banner'))).toEqual([400, 'INVALID_KIND'])
    expect(await answer(upload(png, cookies.admin, 'logoLight', false))).toEqual([503, 'NOT_CONNECTED'])
    expect(await answer(upload(tooBig(), cookies.admin))).toEqual([413, 'TOO_LARGE'])
    expect(await answer(upload(new TextEncoder().encode('GIF89a'), cookies.admin))).toEqual([415, 'UNSUPPORTED_TYPE'])
    expect(await answer(upload('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', cookies.admin, 'mark'))).toEqual([415, 'UNSAFE_SVG'])
    expect(stored.size).toBe(before)
  })

  it('refuses a role without branding.write before the kind, the bucket or the body, and leaves the body unread', async () => {
    const cases: [BodyInit, string, BrandFileStore | null][] = [
      [png, 'kind=banner', store],
      [png, 'kind=logoLight', null],
      [tooBig(), 'kind=logoLight', store],
    ]
    for (const [body, query, withStore] of cases) {
      const request = brandRequest(body, cookies.reader, query)
      expect(await answer(send(request, withStore))).toEqual([403, 'FORBIDDEN'])
      expect(request.bodyUsed).toBe(false)
    }
  })

  it('refuses a body over the limit sent without a Content-Length, and stops reading it', async () => {
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (sent >= 16) return controller.close()
        const chunk = new Uint8Array(64 * 1024)
        if (sent === 0) chunk.set(png)
        sent += 1
        controller.enqueue(chunk)
      },
    })
    const request = brandRequest(body, cookies.admin)
    expect(request.headers.get('content-length')).toBeNull()
    const before = stored.size
    expect(await answer(send(request))).toEqual([413, 'TOO_LARGE'])
    expect(sent).toBeLessThan(16)
    expect(stored.size).toBe(before)
  })

  it('logs nothing when the bucket write fails', async () => {
    const before = await logged(t.partnerA)
    const failing: BrandFileStore = {
      put: async () => {
        throw new Error('R2 unavailable')
      },
    }
    await expect(send(brandRequest(png, cookies.admin), failing)).rejects.toThrow('R2 unavailable')
    expect(await logged(t.partnerA)).toBe(before)
  })

  it('files a partner B upload under B’s prefix and B’s log, whatever partner or key the request names', async () => {
    const beforeA = await logged(t.partnerA)
    const query = `kind=mark&partner=${t.partnerA}&partnerId=${t.partnerA}&key=partners/${t.partnerA}/brand/evil.png`
    const response = await send(brandRequest(png, cookies.adminB, query))
    const body = (await response.json()) as { ok: boolean; key: string }
    expect(response.status).toBe(200)
    expect(body.key).toMatch(new RegExp(`^partners/${t.partnerB}/brand/[0-9a-f-]{36}\\.png$`))
    expect([...stored.keys()].filter((key) => key.includes('evil') || (key !== body.key && key.startsWith(`partners/${t.partnerB}/`)))).toEqual([])
    const [entry] = await db.sql`select partner_id from activity_log where target_id = ${body.key}`
    expect(entry).toMatchObject({ partner_id: t.partnerB })
    expect(await logged(t.partnerA)).toBe(beforeA)

    const before = stored.size
    expect(await answer(upload(`partners/${t.partnerA}/brand/evil.png`, cookies.adminB))).toEqual([415, 'UNSUPPORTED_TYPE'])
    expect(stored.size).toBe(before)
  })
})
