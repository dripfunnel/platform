import type { ScopedSql } from '#db/scoped/index'
import type { IdentityClaims } from './oidc'
import { SignInFailed } from './oidc'

export const staffRoles = [
  'staff-super-admin',
  'staff-partner-manager',
  'staff-support',
  'staff-finance',
  'staff-engineer',
  'staff-read-only',
] as const

export type StaffRole = (typeof staffRoles)[number]

export interface StaffMember {
  id: string
  email: string
  name: string
  role: StaffRole
}

/**
 * The provider says who someone is; this says whether they work here. Unknown and suspended
 * raise the same detail-free refusal, so neither can be told from the other (CONSOLE-DESIGN A1).
 */
export const staffForClaims = async (tx: ScopedSql, claims: IdentityClaims): Promise<StaffMember> => {
  const rows = await tx<{ id: string; email: string; name: string; role_key: StaffRole; status: string }[]>`
    select id, email, name, role_key, status from staff_user where sso_subject = ${claims.subject}
  `
  const row = rows[0]
  if (!row) throw new SignInFailed('no staff record for this subject')
  if (row.status !== 'active') throw new SignInFailed(`staff record is ${row.status}`)
  return { id: row.id, email: row.email, name: row.name, role: row.role_key }
}

export const staffById = async (tx: ScopedSql, id: string): Promise<StaffMember | null> => {
  const rows = await tx<{ id: string; email: string; name: string; role_key: StaffRole; status: string }[]>`
    select id, email, name, role_key, status from staff_user where id = ${id} and status = 'active'
  `
  const row = rows[0]
  return row ? { id: row.id, email: row.email, name: row.name, role: row.role_key } : null
}
