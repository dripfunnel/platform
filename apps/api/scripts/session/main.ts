import postgres from 'postgres'
import { z } from 'zod'
import { createPartnerSession, partnerCookieName } from '#auth/partnerSession'
import { cookieName } from '#auth/session'
import { createSession } from '#auth/session'
import { withSystemScope } from '#db/scoped/index'
import { assertLoopbackOnly } from '../migrate/host-guard'

// A session for the LOCAL database only, so the consoles can be used against the seed before
// sign-in exists (staff: THIRD-PARTY-ACCESS.md §2.5; partner users: #156). Prints the cookie
// to set: `session <staff email>` for the admin console, `session --partner <email>` for the
// partner console.
const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env)
assertLoopbackOnly(env.DATABASE_URL)

const partner = process.argv[2] === '--partner'
const email = z.email().parse(process.argv[partner ? 3 : 2] ?? '')
const sql = postgres(env.DATABASE_URL, { max: 1 })
try {
  const cookie = await withSystemScope(sql, async (tx) => {
    if (partner) {
      const users = await tx<{ id: string; status: string }[]>`select id, status from partner_user where lower(email) = lower(${email})`
      if (users.length !== 1) throw new Error(`${users.length} partner users with email ${email} in the local database; expected one. Run pnpm seed first.`)
      const [user] = users
      if (user?.status !== 'active') throw new Error(`${email} is ${user?.status ?? 'missing'}, not active.`)
      return `${partnerCookieName}=${await createPartnerSession(tx, user.id, new Date())}`
    }
    const [staff] = await tx<{ id: string; status: string }[]>`select id, status from staff_user where email = ${email}`
    if (!staff) throw new Error(`No staff member with email ${email} in the local database. Run pnpm seed first.`)
    if (staff.status !== 'active') throw new Error(`${email} is ${staff.status}, not active.`)
    return `${cookieName}=${await createSession(tx, staff.id, new Date())}`
  })
  console.log(cookie)
} finally {
  await sql.end()
}
