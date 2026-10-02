import postgres from 'postgres'
import { z } from 'zod'
import { cookieName } from '#auth/session'
import { createSession } from '#auth/session'
import { withSystemScope } from '#db/scoped/index'
import { assertLoopbackOnly } from '../migrate/host-guard'

// A staff session for the LOCAL database only, so the consoles can be used against the seed
// before Entra sign-in is configured (THIRD-PARTY-ACCESS.md §2.5). Prints the cookie to set.
const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env)
assertLoopbackOnly(env.DATABASE_URL)

const email = z.email().parse(process.argv[2] ?? '')
const sql = postgres(env.DATABASE_URL, { max: 1 })
try {
  const id = await withSystemScope(sql, async (tx) => {
    const [staff] = await tx<{ id: string; status: string }[]>`select id, status from staff_user where email = ${email}`
    if (!staff) throw new Error(`No staff member with email ${email} in the local database. Run pnpm seed first.`)
    if (staff.status !== 'active') throw new Error(`${email} is ${staff.status}, not active.`)
    return createSession(tx, staff.id, new Date())
  })
  console.log(`${cookieName}=${id}`)
} finally {
  await sql.end()
}
