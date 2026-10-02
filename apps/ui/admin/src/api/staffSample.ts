// DripFunnel's own staff, served the way #39 would: paged by cursor, each action allowed or
// refused with its reason. It stands in for the server until #68 wires the screen to #39.
import type { StaffRole } from '../features/shell/staffRoles'
import { pageByCursor, type PageRequest } from '@dripfunnel/shared/graphql'
import type { ActionPermission } from './permissions'
import type { StaffMember, StaffPage, StaffRefusal, StaffResult } from './staff'

interface SampleStaff {
  id: string
  name: string | null
  email: string
  role: StaffRole
  lastSignInAt: string | null
  twoFactor: StaffMember['twoFactor']
  invitedAt: string | null
}

const dayMs = 86_400_000
const hourMs = 3_600_000
const linkMs = 7 * dayMs

// Ids match the activity sample's, so My activity opens a timeline with entries.
const seed = (now: number): SampleStaff[] => {
  const ago = (ms: number) => new Date(now - ms).toISOString()
  const member = (id: string, name: string, email: string, role: StaffRole, signedIn: number, twoFactor: 'on' | 'off' = 'on'): SampleStaff => ({
    id,
    name,
    email,
    role,
    lastSignInAt: ago(signedIn),
    twoFactor,
    invitedAt: null,
  })
  const invited = (id: string, email: string, role: StaffRole, sent: number): SampleStaff => ({
    id,
    name: null,
    email,
    role,
    lastSignInAt: null,
    twoFactor: 'notSignedIn',
    invitedAt: ago(sent),
  })
  return [
    member('st-arjun', 'Arjun Menon', 'arjun@dripfunnel.com', 'staff-super-admin', 2 * hourMs),
    member('st-maya', 'Maya Ortiz', 'maya.ortiz@dripfunnel.com', 'staff-partner-manager', 3 * hourMs),
    member('st-priya', 'Priya Shah', 'priya.shah@dripfunnel.com', 'staff-partner-manager', 5 * hourMs),
    member('st-neha', 'Neha Rao', 'neha@dripfunnel.com', 'staff-support', 4 * hourMs),
    member('st-lena', 'Lena Fischer', 'lena@dripfunnel.com', 'staff-engineer', 6 * hourMs),
    member('st-tom', 'Tom Becker', 'tom@dripfunnel.com', 'staff-finance', 1 * hourMs),
    member('st-sam', 'Sam Lee', 'sam@dripfunnel.com', 'staff-read-only', 9 * dayMs, 'off'),
    invited('st-kiran', 'kiran@dripfunnel.com', 'staff-support', 2 * dayMs),
    invited('st-noor', 'noor@dripfunnel.com', 'staff-finance', 9 * dayMs),
  ]
}

const superAdmin: StaffRole = 'staff-super-admin'
const refused = (reason: StaffRefusal): StaffResult => ({ ok: false, reason })
const done: StaffResult = { ok: true }

export interface StaffServerOptions {
  now?: () => number
}

export const createStaffServer = (options: StaffServerOptions = {}) => {
  const now = options.now ?? Date.now
  let staff = seed(now())
  let nextId = 1

  const isActive = (member: SampleStaff) => member.invitedAt === null
  // Only accepted Super admins keep the console reachable; an invitation may never be accepted.
  const activeSuperAdmins = () => staff.filter((member) => isActive(member) && member.role === superAdmin).length
  const isLastSuperAdmin = (member: SampleStaff) => isActive(member) && member.role === superAdmin && activeSuperAdmins() === 1
  const find = (id: string) => staff.find((member) => member.id === id)

  const actionsOf = (member: SampleStaff): StaffMember['actions'] => {
    const guard: ActionPermission<StaffRefusal> = isLastSuperAdmin(member) ? { allowed: false, reason: 'LAST_SUPER_ADMIN' } : { allowed: true }
    return isActive(member) ? { changeRole: guard, remove: guard } : { changeRole: guard, resend: { allowed: true }, revoke: { allowed: true } }
  }

  const toMember = (member: SampleStaff): StaffMember => {
    const invitation =
      member.invitedAt === null
        ? null
        : {
            sentAt: member.invitedAt,
            expiresAt: new Date(Date.parse(member.invitedAt) + linkMs).toISOString(),
            expired: now() >= Date.parse(member.invitedAt) + linkMs,
          }
    return {
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      lastSignInAt: member.lastSignInAt,
      twoFactor: member.twoFactor,
      invitation,
      actions: actionsOf(member),
    }
  }

  // Accepted staff by name, then invitations, newest first.
  const ordered = () => [
    ...staff.filter(isActive).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    ...staff.filter((member) => !isActive(member)).sort((a, b) => (b.invitedAt ?? '').localeCompare(a.invitedAt ?? '')),
  ]

  // The Staff query and every mutation are Super admin only (README.md §2).
  const list = (page: PageRequest, size: number, caller: StaffRole): StaffPage | null => {
    if (caller !== superAdmin) return null
    const { items, pageInfo } = pageByCursor(ordered(), page, size)
    return { items: items.map(toMember), pageInfo, soleSuperAdmin: activeSuperAdmins() < 2 }
  }

  const invite = (email: string, role: StaffRole, caller: StaffRole): StaffResult => {
    if (caller !== superAdmin) return refused('SUPER_ADMIN_ONLY')
    const address = email.trim().toLowerCase()
    if (staff.some((member) => member.email === address)) return refused('ALREADY_STAFF')
    staff = [...staff, { id: `st-new-${nextId++}`, name: null, email: address, role, lastSignInAt: null, twoFactor: 'notSignedIn', invitedAt: new Date(now()).toISOString() }]
    return done
  }

  const changeRole = (id: string, role: StaffRole, caller: StaffRole): StaffResult => {
    if (caller !== superAdmin) return refused('SUPER_ADMIN_ONLY')
    const member = find(id)
    if (!member) return refused('NOT_FOUND')
    if (member.role === role) return refused('SAME_ROLE')
    if (role !== superAdmin && isLastSuperAdmin(member)) return refused('LAST_SUPER_ADMIN')
    staff = staff.map((other) => (other.id === id ? { ...other, role } : other))
    return done
  }

  // Their entries stay in the activity log; only the sign-in goes (LOGGING.md §4).
  const remove = (id: string, caller: StaffRole): StaffResult => {
    if (caller !== superAdmin) return refused('SUPER_ADMIN_ONLY')
    const member = find(id)
    if (!member) return refused('NOT_FOUND')
    if (!isActive(member)) return refused('PENDING_INVITATION')
    if (isLastSuperAdmin(member)) return refused('LAST_SUPER_ADMIN')
    staff = staff.filter((other) => other.id !== id)
    return done
  }

  // A new link, valid for another 7 days; the old one stops working (ACCESS.md §6.3).
  const resend = (id: string, caller: StaffRole): StaffResult => {
    if (caller !== superAdmin) return refused('SUPER_ADMIN_ONLY')
    const member = find(id)
    if (!member) return refused('NOT_FOUND')
    if (isActive(member)) return refused('NOT_PENDING')
    staff = staff.map((other) => (other.id === id ? { ...other, invitedAt: new Date(now()).toISOString() } : other))
    return done
  }

  const revoke = (id: string, caller: StaffRole): StaffResult => {
    if (caller !== superAdmin) return refused('SUPER_ADMIN_ONLY')
    const member = find(id)
    if (!member) return refused('NOT_FOUND')
    if (isActive(member)) return refused('NOT_PENDING')
    staff = staff.filter((other) => other.id !== id)
    return done
  }

  return { list, invite, changeRole, remove, resend, revoke }
}

export const staffServer = createStaffServer()
