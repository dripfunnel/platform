import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleAuth } from '#apis/admin/auth'
import type { ActivityEntry } from '#auth/activity'
import { resolveStaff } from '#auth/caller'
import { SignInFailed } from '#auth/oidc'
import {
  absoluteMs,
  cookieName,
  createSession,
  endSession,
  hashSessionId,
  idleMs,
  isReauthFresh,
  readSession,
} from '#auth/session'
import { staffForClaims } from '#auth/staff'
import type { ScopedSql } from '#db/scoped/index'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'

let db: TestDatabase
let active: string
let suspended: string
let other: string

const at = (ms: number) => new Date(Date.UTC(2026, 9, 1, 9, 0, 0) + ms)
const start = at(0)

beforeAll(async () => {
  db = await createTestDatabase()
  const rows = await db.sql<{ id: string; sso_subject: string }[]>`
    insert into staff_user (sso_subject, email, name, role_key, status) values
      ('subject-active', 'priya@softobotics.com', 'Priya', 'staff-super-admin', 'active'),
      ('subject-suspended', 'gone@softobotics.com', 'Gone', 'staff-support', 'suspended'),
      ('subject-other', 'sam@softobotics.com', 'Sam', 'staff-read-only', 'active')
    returning id, sso_subject
  `
  const idFor = (subject: string) => {
    const row = rows.find((r) => r.sso_subject === subject)
    if (!row) throw new Error(`fixture missing ${subject}`)
    return row.id
  }
  active = idFor('subject-active')
  suspended = idFor('subject-suspended')
  other = idFor('subject-other')
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

describe('who the request resolves to', () => {
  const withSession = (id: string) =>
    new Request('https://admin.dripfunnel.com/api', { headers: { cookie: `${cookieName}=${id}` } })

  it('is nobody without a cookie', async () => {
    expect(await resolveStaff(db.sql, new Request('https://admin.dripfunnel.com/api'), start)).toBeNull()
  })

  it('is the staff member while the session is live', async () => {
    const id = await withSystemScope(db.sql, (tx) => createSession(tx, active, start))
    expect(await resolveStaff(db.sql, withSession(id), start)).toMatchObject({ staff: { id: active }, reauthFresh: true })
  })

  it('is nobody once the session has expired', async () => {
    const id = await withSystemScope(db.sql, (tx) => createSession(tx, active, start))
    expect(await resolveStaff(db.sql, withSession(id), at(absoluteMs + 1000))).toBeNull()
  })

  it('is nobody once the staff member is suspended, without waiting for the session to end', async () => {
    // Removing someone takes effect on their next request, not when their session expires:
    // `staffById` filters on status, and only this notices if that filter goes.
    const id = await withSystemScope(db.sql, (tx) => createSession(tx, active, start))
    expect(await resolveStaff(db.sql, withSession(id), start)).not.toBeNull()

    await db.sql`update staff_user set status = 'suspended' where id = ${active}`
    try {
      expect(await resolveStaff(db.sql, withSession(id), start)).toBeNull()
    } finally {
      await db.sql`update staff_user set status = 'active' where id = ${active}`
    }
  })
})

describe('row-level security on the staff tables', () => {
  const asPlatform = <T>(work: (tx: postgres.TransactionSql) => Promise<T>) =>
    db.sql.begin(async (tx) => {
      await tx`set local role app_platform`
      await tx`select set_config('app.scope', 'platform', true)`
      return work(tx)
    })

  it('lets no store caller read staff', async () => {
    const rows = await db.sql.begin(async (tx) => {
      await tx`set local role app_request`
      await tx`select set_config('app.scope', 'store', true)`
      return tx`select id from staff_user`
    })
    expect(rows).toHaveLength(0)
  })

  it('lets a platform caller read staff, and touch no session at all', async () => {
    const seen = await asPlatform((tx) => tx`select id from staff_user`)
    expect(seen.length).toBeGreaterThan(0)

    // Neither granted nor policied: a session hash is a credential, and only `system` scope
    // has any reason to see one.
    await expect(asPlatform((tx) => tx`select id_hash from staff_session`)).rejects.toThrow(/permission denied/i)
    await expect(
      asPlatform(
        (tx) => tx`insert into staff_session (id_hash, staff_user_id, expires_at)
                   values ('x', ${active}, ${at(absoluteMs)})`,
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  // #39: the Staff menu changes a role or a status, and the service holds that to Super admins;
  // who a member is (their SSO account, email and name) is sign-in's alone.
  it('lets a staff request change only a role or a status, never who a member is', async () => {
    for (const set of ["sso_subject = 'stolen'", "email = 'x@example.com'", "name = 'x'", 'last_sign_in_at = now()']) {
      await expect(asPlatform((tx) => tx.unsafe(`update staff_user set ${set} where id = '${active}'`)), set).rejects.toThrow(/permission denied/i)
    }
    await expect(asPlatform((tx) => tx`insert into staff_user (sso_subject, email, name, role_key, status) values ('s', 'e@x.com', 'n', 'staff-super-admin', 'active')`)).rejects.toThrow(/permission denied/i)
    await expect(asPlatform((tx) => tx`insert into staff_user (email, name, role_key, status) values ('e@x.com', '', 'staff-super-admin', 'active')`)).rejects.toThrow(/row-level security/i)
  })

  it('lets a staff request only remove a member, never activate or suspend one', async () => {
    const [invited] = await db.sql<{ id: string }[]>`
      insert into staff_user (email, name, role_key, status) values ('invited@softobotics.com', '', 'staff-super-admin', 'invited') returning id`
    if (!invited) throw new Error('fixture missing invited member')
    for (const status of ['active', 'suspended']) {
      await expect(asPlatform((tx) => tx`update staff_user set status = ${status} where id = ${invited.id}`), status).rejects.toThrow(/may only remove/i)
    }
    await expect(asPlatform((tx) => tx`update staff_user set status = 'active' where id = ${suspended}`)).rejects.toThrow(/may only remove/i)
    await asPlatform((tx) => tx`update staff_user set status = 'removed' where id = ${invited.id}`)
    await expect(asPlatform((tx) => tx`update staff_user set status = 'invited' where id = ${invited.id}`)).rejects.toThrow(/may only remove/i)
    expect((await db.sql`select status from staff_user where id = ${invited.id}`)[0]?.status).toBe('removed')
  })

  it('never lets a staff request read the hash of an invitation link', async () => {
    await expect(asPlatform((tx) => tx`select token_hash from staff_invitation`)).rejects.toThrow(/permission denied/i)
    await expect(asPlatform((tx) => tx`select id from staff_invitation`)).resolves.toBeDefined()
  })
})

describe('the sign-in routes', () => {
  const provider = {
    authorizeUrl: () => 'https://login.microsoftonline.com/authorize?state=s',
    exchange: async ({ code }: { code: string }) => {
      if (code === 'good') return claims('subject-active')
      if (code === 'unknown') return claims('nobody')
      if (code === 'suspended') return claims('subject-suspended')
      throw new SignInFailed('provider_refused')
    },
  }

  const deps = (overrides: Partial<Parameters<typeof handleAuth>[1]> = {}) => ({
    sql: db.sql,
    provider,
    activity: activityLog,
    adminHost: 'admin.dripfunnel.com',
    now: () => start,
    allowAttempt: async () => true,
    ...overrides,
  })

  const callback = (code: string, { state = 'state', ...headers }: Record<string, string> = {}) =>
    new Request(`https://admin.dripfunnel.com/api/auth/callback?code=${code}&state=${state}`, {
      headers: { cookie: '__Host-df_admin_oidc=state.nonce.signin', ...headers },
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
        return { status: res.status, location: res.headers.get('location'), cookie: res.headers.get('set-cookie') }
      }),
    )
    // Identical down to the headers: a difference in any of them is a way to tell the
    // causes apart. `refused` is the one state every account question collapses into.
    for (const res of responses) {
      expect(res).toEqual(responses[0])
      expect(res).toMatchObject({ status: 302, location: '/sign-in?outcome=refused' })
    }
  })

  it('answers an outage mid-sign-in with the screen’s unavailable state, logged by code, and files no refusal', async () => {
    const lines: string[] = []
    const log = console.log
    console.log = (line: string) => void lines.push(line)
    let res: Response
    try {
      const outage = { ...provider, exchange: async () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:5432'), { code: 'ECONNREFUSED' })) }
      res = await handleAuth(callback('good', { 'cf-ray': 'ray-outage' }), deps({ provider: outage }))
    } finally {
      console.log = log
    }
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/sign-in?outcome=unavailable')
    expect(res.headers.get('set-cookie')).toContain('__Host-df_admin_oidc=;')
    expect(lines.map((l) => JSON.parse(l) as Record<string, unknown>)).toEqual([{ event: 'sign_in_unavailable', api: 'admin', requestId: 'ray-outage', code: 'Error:ECONNREFUSED' }])
    expect(lines.join('\n')).not.toContain('10.0.0.9')
    expect(await db.sql`select 1 from activity_log where action = 'staff.sign_in_refused' and request_id = 'ray-outage'`).toHaveLength(0)
  })

  it('rolls the sign-in back when the database fails inside it: no session, no entry, the unavailable state', async () => {
    const before = (await db.sql<{ n: number }[]>`select count(*)::int as n from staff_session where staff_user_id = ${active}`)[0]?.n ?? 0
    const failing = {
      recordAll: async () => undefined,
      record: async () => {
        throw Object.assign(new Error('could not write activity_log at 10.0.0.9'), { name: 'PostgresError', code: 'XX000' })
      },
    }
    const log = console.log
    console.log = () => undefined
    let res: Response
    try {
      res = await handleAuth(callback('good', { 'cf-ray': 'ray-db-outage' }), deps({ activity: failing as unknown as typeof activityLog }))
    } finally {
      console.log = log
    }
    expect(res.headers.get('location')).toBe('/sign-in?outcome=unavailable')
    expect(res.headers.get('set-cookie')).not.toContain(`${cookieName}=`)
    expect((await db.sql<{ n: number }[]>`select count(*)::int as n from staff_session where staff_user_id = ${active}`)[0]?.n).toBe(before)
    expect(await db.sql`select 1 from activity_log where request_id = 'ray-db-outage'`).toHaveLength(0)
  })

  it('rate-limits the callback', async () => {
    const res = await handleAuth(callback('good'), deps({ allowAttempt: async () => false }))
    expect(res.status).toBe(429)
  })

  it('records the sign-in as an activity entry and prints nothing', async () => {
    // LOGGING.md §4: the entry carries the label and address, which is why it lives in the
    // table and not in a log line.
    const lines: string[] = []
    const log = console.log
    console.log = (line: string) => void lines.push(line)
    try {
      await handleAuth(callback('good', { 'cf-connecting-ip': '203.0.113.1' }), deps())
    } finally {
      console.log = log
    }
    expect(lines).toEqual([])
    const [row] = await db.sql<{ actor_id: string; actor_label: string; ip: string; visibility: string }[]>`
      select actor_id, actor_label, ip, visibility from activity_log
      where action = 'staff.signed_in' order by occurred_at desc limit 1
    `
    expect(row).toEqual({ actor_id: active, actor_label: 'Priya <priya@softobotics.com>', ip: '203.0.113.1', visibility: 'staff' })
  })

  it('refuses claims the provider returns in a shape we cannot use', async () => {
    // Malformed claims must not answer differently from an unknown subject: a 500 here would
    // tell the caller their code reached the provider and the failure was ours.
    const malformed = {
      ...provider,
      exchange: async () => ({ subject: '', email: 'not-an-email', name: '' }) as never,
    }
    const res = await handleAuth(callback('good'), deps({ provider: malformed }))
    expect({ status: res.status, location: res.headers.get('location') }).toEqual({
      status: 302,
      location: '/sign-in?outcome=refused',
    })
  })

  it('records why each refusal happened while telling the caller nothing', async () => {
    const seen: (string | null)[] = []
    const capturing = { record: async (_tx: ScopedSql, entry: ActivityEntry) => void seen.push(entry.reason), recordAll: async () => undefined }
    const cases = [
      [callback('good', { state: 'not-ours' }), 'state_mismatch'],
      [callback('good', { cookie: 'nothing=here' }), 'missing_handshake'],
      [callback('unknown'), 'unknown_subject'],
      [callback('suspended'), 'staff_suspended'],
      [callback('rubbish'), 'provider_refused'],
    ] as const

    const shown = new Set<string>()
    for (const [request] of cases) {
      const res = await handleAuth(request, deps({ activity: capturing }))
      expect(res.status).toBe(302)
      shown.add(res.headers.get('location') ?? '')
    }
    // One destination for every cause, while the operator gets five distinct reasons.
    expect([...shown]).toEqual(['/sign-in?outcome=refused'])
    expect(seen).toEqual(cases.map(([, reason]) => reason))
  })

  it('refuses identically when recording the refusal fails', async () => {
    // Otherwise a caller who can push the database over can tell which refusals reach it.
    const failing = {
      recordAll: async () => undefined,
      record: async () => {
        throw new Error('the database is down')
      },
    }
    const forged = await handleAuth(callback('good', { state: 'not-ours' }), deps({ activity: failing }))
    const unknown = await handleAuth(callback('unknown'), deps({ activity: failing }))
    for (const res of [forged, unknown]) {
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/sign-in?outcome=refused')
    }
  })

  it('refuses a callback whose state does not match what we sent', async () => {
    const res = await handleAuth(callback('good', { state: 'not-ours' }), deps())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/sign-in?outcome=refused')
  })

  describe('re-authentication before a dangerous action (A2)', () => {
    const freshnessOf = async (sessionId: string, now: Date) => {
      const session = await withSystemScope(db.sql, (tx) => readSession(tx, sessionId, now))
      if (!session) throw new Error('the session should still be live')
      return isReauthFresh(session, now)
    }

    const reauthCallback = (sessionId: string) =>
      new Request('https://admin.dripfunnel.com/api/auth/callback?code=good&state=state', {
        headers: { cookie: `__Host-df_admin_oidc=state.nonce.reauth; ${cookieName}=${sessionId}` },
      })

    it('asks Microsoft for the credential again, not just its own session', async () => {
      const seen: string[] = []
      const recording = {
        ...provider,
        authorizeUrl: (options: { prompt?: string }) => {
          seen.push(options.prompt ?? 'none')
          return 'https://login.microsoftonline.com/authorize'
        },
      }
      await handleAuth(new Request('https://admin.dripfunnel.com/api/auth/sign-in'), deps({ provider: recording }))
      await handleAuth(new Request('https://admin.dripfunnel.com/api/auth/reauth'), deps({ provider: recording }))
      expect(seen).toEqual(['none', 'login'])
    })

    it('keeps the signed-in session when re-authentication meets an outage, and shows the unavailable state', async () => {
      const id = await withSystemScope(db.sql, (tx) => createSession(tx, active, start))
      const outage = { ...provider, exchange: async () => Promise.reject(Object.assign(new Error('upstream 503'), { code: 'EAI_AGAIN' })) }
      const log = console.log
      console.log = () => undefined
      let res: Response
      try {
        res = await handleAuth(reauthCallback(id), deps({ provider: outage }))
      } finally {
        console.log = log
      }
      expect(res.headers.get('location')).toBe('/sign-in?outcome=unavailable')
      // Only the handshake is cleared; the session cookie and the session itself stay.
      expect(res.headers.get('set-cookie')).toContain('__Host-df_admin_oidc=;')
      expect(res.headers.get('set-cookie')).not.toContain(`${cookieName}=`)
      const stillSignedIn = new Request('https://admin.dripfunnel.com/api/', { headers: { cookie: `${cookieName}=${id}` } })
      expect(await resolveStaff(db.sql, stillSignedIn, start)).toMatchObject({ staff: { id: active } })
    })

    it('stamps the live session rather than starting a second one', async () => {
      const id = await withSystemScope(db.sql, (tx) => createSession(tx, active, start))
      await db.sql`update staff_session set reauth_at = ${at(-60 * 60 * 1000)} where id_hash = ${await hashSessionId(id)}`

      expect(await freshnessOf(id, start)).toBe(false)

      const res = await handleAuth(reauthCallback(id), deps())
      expect(res.status).toBe(302)
      // No new session cookie: the one they already hold is the one that was refreshed.
      expect(res.headers.get('set-cookie')).not.toContain(cookieName)

      expect(await freshnessOf(id, start)).toBe(true)
    })

    it('refuses to refresh a session that belongs to someone else', async () => {
      // Otherwise a second staff member could hold a dangerous action open for the first.
      const theirs = await withSystemScope(db.sql, (tx) => createSession(tx, other, start))
      await db.sql`update staff_session set reauth_at = ${at(-60 * 60 * 1000)} where id_hash = ${await hashSessionId(theirs)}`

      const res = await handleAuth(reauthCallback(theirs), deps())
      expect(res.headers.get('location')).toBe('/sign-in?outcome=refused')

      expect(await freshnessOf(theirs, start)).toBe(false)
    })

    it('refuses a re-authentication with no session to stamp', async () => {
      const res = await handleAuth(
        new Request('https://admin.dripfunnel.com/api/auth/callback?code=good&state=state', {
          headers: { cookie: '__Host-df_admin_oidc=state.nonce.reauth' },
        }),
        deps(),
      )
      expect(res.headers.get('location')).toBe('/sign-in?outcome=refused')
    })
  })

  it('believes nothing a caller reports without the handshake it issued', async () => {
    // Otherwise any page could send a staff member's browser here and pick both the screen
    // they see and the reason written to the activity log.
    const seen: (string | null)[] = []
    const capturing = { record: async (_tx: ScopedSql, entry: ActivityEntry) => void seen.push(entry.reason), recordAll: async () => undefined }
    const forged = new Request(
      'https://admin.dripfunnel.com/api/auth/callback?error=invalid_grant&error_description=AADSTS53003',
    )
    const res = await handleAuth(forged, deps({ activity: capturing }))
    expect(res.headers.get('location')).toBe('/sign-in?outcome=refused')
    expect(seen).toEqual(['missing_handshake'])
  })

  it('sends each provider failure to the screen that explains it', async () => {
    // These say nothing about whether an account exists, so unlike the refusals above they
    // are allowed to differ (#17's states).
    const cases = [
      ['error=access_denied', '/sign-in?outcome=cancelled'],
      ['error=invalid_grant&error_description=AADSTS500121%3A+denied', '/sign-in?outcome=denied'],
      ['error=invalid_grant&error_description=AADSTS53003%3A+blocked', '/sign-in?outcome=blocked'],
      ['error=temporarily_unavailable', '/sign-in?outcome=unavailable'],
    ] as const
    for (const [query, expected] of cases) {
      const request = new Request(`https://admin.dripfunnel.com/api/auth/callback?state=state&${query}`, {
        headers: { cookie: '__Host-df_admin_oidc=state.nonce.signin' },
      })
      const res = await handleAuth(request, deps())
      expect([query, res.headers.get('location')]).toEqual([query, expected])
    }
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
