import type { StaffAction, StaffMember, StaffRefusal } from '../../api/staff'
import { fill, messages } from '../../messages'
import type { ConfirmDialogProps } from '../common/ConfirmDialog'
import { staffRoles, type StaffRole } from '../shell/staffRoles'

const words = messages.staff
const roleNames = messages.shell.roles

export type StaffDialogKind = 'invite' | StaffAction

export type StaffDialog = Pick<ConfirmDialogProps, 'title' | 'target' | 'consequence' | 'confirmLabel' | 'notes' | 'input' | 'choice' | 'danger'>

// An invitation has no name until its SSO sign-in, so it goes by its email.
export const labelOf = (member: StaffMember) => member.name ?? member.email

const roleOptions = staffRoles.map((role) => ({ value: role, label: roleNames[role] }))

export const isStaffRole = (value: string): value is StaffRole => staffRoles.some((role) => role === value)

const roleName = (value: string) => (isStaffRole(value) ? roleNames[value] : '')

// Loose on purpose: any domain for now (decided on #45); the invitation itself proves the address.
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Each confirmation names the person and says what happens, in the prototype's words (FIRST-RELEASE.md §10).
export const staffDialog = (kind: StaffDialogKind, member: StaffMember | null, meId: string): StaffDialog | null => {
  if (kind === 'invite') {
    const spec = words.dialogs.invite
    return {
      title: spec.title,
      target: spec.target,
      consequence: (email, role) => fill(spec.consequence, { email: email.trim() || spec.someone, role: roleName(role) }),
      confirmLabel: spec.confirm,
      input: { label: spec.email, type: 'email', initial: '', placeholder: spec.emailPlaceholder, error: (email) => (emailPattern.test(email.trim()) ? null : spec.emailError) },
      choice: { label: words.dialogs.role, options: roleOptions, initial: 'staff-support', error: () => null },
    }
  }
  if (!member) return null
  const name = labelOf(member)
  const self = member.id === meId
  switch (kind) {
    case 'changeRole': {
      const spec = words.dialogs.changeRole
      return {
        title: fill(spec.title, { name }),
        target: name,
        consequence: (_value, role) =>
          fill(role === member.role ? spec.current : self ? spec.self : spec.consequence, { name, role: roleName(role) }),
        confirmLabel: spec.confirm,
        choice: { label: words.dialogs.role, options: roleOptions, initial: member.role, error: (role) => (role === member.role ? spec.sameRole : null) },
      }
    }
    case 'remove': {
      const spec = words.dialogs.remove
      return {
        title: fill(spec.title, { name }),
        target: name,
        consequence: fill(spec.consequence, { name }),
        confirmLabel: spec.confirm,
        ...(self ? { notes: [spec.self] } : {}),
        danger: true,
      }
    }
    case 'resend':
    case 'revoke': {
      const spec = words.dialogs[kind]
      return {
        title: fill(spec.title, { name }),
        target: name,
        consequence: fill(spec.consequence, { email: member.email }),
        confirmLabel: spec.confirm,
        danger: kind === 'revoke',
      }
    }
  }
}

export const refusalText = (reason: StaffRefusal, name: string) => fill(words.refusals[reason], { name })

export const staffToast = (kind: StaffDialogKind, values: { name: string; email: string; role: string }) =>
  fill(words.toasts[kind], { ...values, role: roleName(values.role) })
