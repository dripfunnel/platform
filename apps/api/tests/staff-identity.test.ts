import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleAuth } from '#apis/admin/auth'
import { noopActivityLog } from '#auth/activity'
import { SignInFailed } from '#auth/oidc'
import { absoluteMs, cookieName, createSession, endSession, idleMs, readSession } from '#auth/session'
import { staffForClaims } from '#auth/staff'
import { withSystemScope } from '#db/scoped/index'
import { createTestDatabase, type TestDatabase } from './support/database'

let db: TestDatabase
let active: string
let suspended: string

const at = (ms: number) => new Date(Date.UTC(2026, 9, 1, 9, 0, 0) + ms)
const start = at(0)

beforeAll(async () => {
  db = await createTestDatabase()
  const rows = await db.sql<{ id: string; sso_subject: string }[]>`
    insert into staff_user (sso_subject, email, name, role_key, status) values
      ('subject-active', 'priya@softobotics.com', 'Priya', 'staff-super-admin', 'active'),
      ('subject-suspended', 'gone@softobotics.com', 'Gone', 'staff-support', 'suspended')
    returning id, sso_subject
  `
  const idFor = (subject: string) => {
    const row = rows.find((r) => r.sso_subject === subject)
    if (!row) throw new Error(`fixture missing ${subject}`)
    return row.id
  }
  active = idFor('subject-active')
  suspended = idFor('subject-suspended')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const claims = (subject: string) => ({ subject, email: 'x@softobotics.com', name: 'X' })

describe('who may sign in', () => {
  it('an active staff member', async () => {
    const staff = await withSystemScope(db.sql, (tx) => staffForClaims(tx, claims('subject-active')))
    expect(staff.id).toBe(active)
    expect(staff.role).toBe('staff-super-admin')
  })

  it('an unknown subject and a suspended one are refused the same way', async () => {
    // CONSOLE-DESIGN A1: refused with no detail. The caller must not learn which it was, so
    // both raise the same error type and the reason stays server-side.
    const unknown = await withSystemScope(db.sql, (tx) =>
      staffForClaims(tx, claims('nobody')).then(() => null, (e: unknown) => e),
    )
    const gone = await withSystemScope(db.sql, (tx) =>
      staffForClaims(tx, claims('subject-suspended')).then(() => null, (e: unknown) => e),
    )
    expect(unknown).toBeInstanceOf(SignInFailed)
    expect(gone).toBeInstanceOf(SignInFailed)
    expect((unknown as Error).message).toBe((gone as Error).message)
    expect(suspended).toBeTruthy()
  })
})

describe('the session', () => {
  it('is readable while live and ends on sign-out', async () => {
    const id = await withSystemScope(db.sql, (tx) => createSession(tx, active, start))
    expect(await withSystemScope(db.sql, (tx) => readSession(tx, id, start))).toMatchObject({ staffUserId: active })
    const who = await withSystemScope(db.sql, (tx) => endSession(tx, id))
    expect(who).toBe(active)
    expect(await withSystemScope(db.sql, (tx) => readSession(tx, id, start))).toBeNull()
  })

  it('is never stored in a form that could be replayed', async () => {
    const id = await withSystemScope(db.sql, (tx) => createSession(tx, active, start))
    const [row] = await db.sql<{ id_hash: string }[]>`select id_hash from staff_session order by created_at desc limit 1`
    expect(row?.id_hash).not.toBe(id)
    expect(row?.id_hash).toHaveLength(64)
  })

  it('ends after an hour idle', async () => {
    // A session each: reading one touches `last_seen_at`, which is what slides the window, so
    // checking both bounds on the same session would only prove the slide.
    const live = await withSystemScope(db.sql, (tx) => createSession(tx, active, start))
    expect(await withSystemScope(db.sql, (tx) => readSession(tx, live, at(idleMs - 1000)))).not.toBeNull()

    const idle = await withSystemScope(db.sql, (tx) => createSession(tx, active, start))
    expect(await withSystemScope(db.sql, (tx) => readSession(tx, idle, at(idleMs + 1000)))).toBeNull()
  })

  it('keeps going while it is used: the idle window slides', async () => {
    const id = await withSystemScope(db.sql, (tx) => createSession(tx, active, start))
    for (const step of [1, 2, 3, 4, 5]) {
      const used = await withSystemScope(db.sql, (tx) => readSession(tx, id, at(step * (idleMs - 60_000))))
      expect(used).not.toBeNull()
    }
  })

  it('ends after eight hours however much it is used', async () => {
    const id = await withSystemScope(db.sql, (tx) => createSession(tx, active, start))
    // Kept alive right up to the absolute bound, then refused past it.
    for (let t = idleMs - 60_000; t < absoluteMs; t += idleMs - 60_000) {
      expect(await withSystemScope(db.sql, (tx) => readSession(tx, id, at(t)))).not.toBeNull()
    }
    expect(await withSystemScope(db.sql, (tx) => readSession(tx, id, at(absoluteMs + 1000)))).toBeNull()
  })

})

describe('row-level security on the staff tables', () => {
  it('lets no store caller read staff', async () => {
    const rows = await db.sql.begin(async (tx) => {
      await tx`set local role app_request`
      await tx`select set_config('app.scope', 'store', true)`
      return tx`select id from staff_user`
    })
    expect(rows).toHaveLength(0)
  })

  it('lets a platform caller read staff but not write a session', async () => {
    const seen = await db.sql.begin(async (tx) => {
      await tx`set local role app_request`
      await tx`select set_config('app.scope', 'platform', true)`
      return tx`select id from staff_user`
    })
    expect(seen.length).toBeGreaterThan(0)

    await expect(
      db.sql.begin(async (tx) => {
        await tx`set local role app_request`
        await tx`select set_config('app.scope', 'platform', true)`
        await tx`insert into staff_session (id_hash, staff_user_id, expires_at)
                 values ('x', ${active}, ${at(absoluteMs)})`
      }),
    ).rejects.toThrow(/row-level security/i)
  })
})

describe('the sign-in routes', () => {
  const provider = {
    authorizeUrl: () => 'https://login.microsoftonline.com/authorize?state=s',
    exchange: async ({ code }: { code: string }) => {
      if (code === 'good') return claims('subject-active')
      if (code === 'unknown') return claims('nobody')
      if (code === 'suspended') return claims('subject-suspended')
      throw new SignInFailed('the provider refused')
    },
  }

  const deps = (overrides: Partial<Parameters<typeof handleAuth>[1]> = {}) => ({
    sql: db.sql,
    provider,
    activity: noopActivityLog,
    adminHost: 'admin.dripfunnel.com',
    now: () => start,
    allowAttempt: async () => true,
    ...overrides,
  })

  const callback = (code: string, { state = 'state', ...headers }: Record<string, string> = {}) =>
    new Request(`https://admin.dripfunnel.com/api/auth/callback?code=${code}&state=${state}`, {
      headers: { cookie: '__Host-df_admin_oidc=state.nonce', ...headers },
    })

  it('sends the browser to the provider and remembers the nonce', async () => {
    const res = await handleAuth(new Request('https://admin.dripfunnel.com/api/auth/sign-in'), deps())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('login.microsoftonline.com')
    expect(res.headers.get('set-cookie')).toContain('__Host-df_admin_oidc=')
  })

  it('signs an active staff member in and sets the session cookie', async () => {
    const res = await handleAuth(callback('good'), deps())
    expect(res.status).toBe(302)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(cookieName)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
  })

  it('refuses an unknown subject, a suspended one and a provider failure identically', async () => {
    const responses = await Promise.all(
      ['unknown', 'suspended', 'provider-error'].map(async (code) => {
        const res = await handleAuth(callback(code), deps())
        return { status: res.status, body: await res.text(), cookie: res.headers.get('set-cookie') }
      }),
    )
    for (const res of responses) {
      expect(res).toEqual({ status: 401, body: 'Sign-in failed', cookie: null })
    }
  })

  it('rate-limits the callback', async () => {
    const res = await handleAuth(callback('good'), deps({ allowAttempt: async () => false }))
    expect(res.status).toBe(429)
  })

  it('refuses claims the provider returns in a shape we cannot use', async () => {
    // Malformed claims must not answer differently from an unknown subject: a 500 here would
    // tell the caller their code reached the provider and the failure was ours.
    const malformed = {
      ...provider,
      exchange: async () => ({ subject: '', email: 'not-an-email', name: '' }) as never,
    }
    const res = await handleAuth(callback('good'), deps({ provider: malformed }))
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 401, body: 'Sign-in failed' })
  })

  it('refuses a callback whose state does not match what we sent', async () => {
    const res = await handleAuth(callback('good', { state: 'not-ours' }), deps())
    expect(res.status).toBe(401)
  })

  it('refuses a sign-out that is not a POST, so no page can force one', async () => {
    const res = await handleAuth(new Request('https://admin.dripfunnel.com/api/auth/sign-out'), deps())
    expect(res.status).toBe(405)
  })

  it('refuses a cross-site POST whatever the cookie says', async () => {
    const res = await handleAuth(
      new Request('https://admin.dripfunnel.com/api/auth/sign-out', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
      deps(),
    )
    expect(res.status).toBe(403)
  })

  it('signs out, clearing the cookie and the row', async () => {
    const signIn = await handleAuth(callback('good'), deps())
    const id = (signIn.headers.get('set-cookie') ?? '').split(';')[0]?.split('=')[1] ?? ''
    const res = await handleAuth(
      new Request('https://admin.dripfunnel.com/api/auth/sign-out', {
        method: 'POST',
        headers: { cookie: `${cookieName}=${id}`, origin: 'https://admin.dripfunnel.com' },
      }),
      deps(),
    )
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(await withSystemScope(db.sql, (tx) => readSession(tx, id, start))).toBeNull()
  })
})
